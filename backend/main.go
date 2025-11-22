package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ledongthuc/pdf"
)

// Document represents a processed document
type Document struct {
	Name        string           `json:"name"`
	Text        string           `json:"text"`
	Chunks      []string         `json:"chunks"`
	ChunkCount  int              `json:"chunkCount"`
	ContentSize int              `json:"contentSize"`
	HasSummary  bool             `json:"hasSummary"`
	Summary     string           `json:"summary,omitempty"`
	CreatedAt   time.Time        `json:"createdAt"`
	textLower   string           // Cached lowercase version for search
	wordIndex   map[string][]int // Word-to-chunk index for faster queries
	mu          sync.RWMutex     // Read-write mutex for thread safety
}

func (d *Document) UpdateSummary(summary string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Summary = summary
	d.HasSummary = true
}

// GetSummaryStatus Method to safely get summary status
func (d *Document) GetSummaryStatus() (bool, string) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.HasSummary, d.Summary
}

// QueryRequest represents a document query request
type QueryRequest struct {
	DocumentName string `json:"documentName"`
	Query        string `json:"query"`
	ModelName    string `json:"modelName"`
}

// QueryResponse represents the response to a document query
type QueryResponse struct {
	Response     string   `json:"response"`
	SourceChunks []string `json:"sourceChunks"`
	UsedSummary  bool     `json:"usedSummary"`
}

// SummarizeRequest represents a summarization request
type SummarizeRequest struct {
	DocumentName string `json:"documentName"`
	ModelName    string `json:"modelName"`
	SummaryType  string `json:"summaryType"`
}

// DocumentStore global storage with concurrent access protection
type DocumentStore struct {
	docs map[string]*Document
	mu   sync.RWMutex
}

func NewDocumentStore() *DocumentStore {
	return &DocumentStore{
		docs: make(map[string]*Document),
	}
}

func (ds *DocumentStore) Get(name string) (*Document, bool) {
	ds.mu.RLock()
	defer ds.mu.RUnlock()
	doc, exists := ds.docs[name]
	return doc, exists
}

func (ds *DocumentStore) Set(name string, doc *Document) {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.docs[name] = doc
}

func (ds *DocumentStore) Delete(name string) bool {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	if _, exists := ds.docs[name]; !exists {
		return false
	}
	delete(ds.docs, name)
	return true
}

func (ds *DocumentStore) UpdateSummary(name, summary string) bool {
	ds.mu.RLock()
	doc, exists := ds.docs[name]
	ds.mu.RUnlock()

	if !exists {
		return false
	}

	doc.UpdateSummary(summary)
	return true
}

func (ds *DocumentStore) List() map[string]interface{} {
	ds.mu.RLock()
	defer ds.mu.RUnlock()

	result := make(map[string]interface{})
	for name, doc := range ds.docs {
		hasSummary, summary := doc.GetSummaryStatus()
		result[name] = map[string]interface{}{
			"chunkCount":  doc.ChunkCount,
			"contentSize": doc.ContentSize,
			"hasSummary":  hasSummary && summary != "",
			"createdAt":   doc.CreatedAt,
		}
	}
	return result
}

var documentStore = NewDocumentStore()

const (
	OllamaApi           = "http://localhost:11434/api"
	MaxRequestSize      = 32 << 20 // 32MB
	DefaultChunkSize    = 512
	MaxConcurrentOllama = 5
	RequestTimeout      = 30 * time.Second
)

// Connection pool for Ollama requests
var ollamaLimiter = make(chan struct{}, MaxConcurrentOllama)

func init() {
	// Fill the limiter channel
	for i := 0; i < MaxConcurrentOllama; i++ {
		ollamaLimiter <- struct{}{}
	}
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Create documents directory
	if err := os.MkdirAll("./documents", 0755); err != nil {
		log.Fatal("Failed to create documents directory:", err)
	}

	// Setup routes
	mux := http.NewServeMux()
	mux.HandleFunc("/api/models", corsHandler(getModels))
	mux.HandleFunc("/api/documents", corsHandler(getDocuments))
	mux.HandleFunc("/api/document/process", corsHandler(processDocument))
	mux.HandleFunc("/api/document/query", corsHandler(queryDocument))
	mux.HandleFunc("/api/document/summarize", corsHandler(summarizeDocument))
	mux.HandleFunc("/api/document/", corsHandler(handleDocumentByName))

	// HTTP server configuration
	server := &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Println("Server starting on http://localhost:8080")
	if err := server.ListenAndServe(); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}

// CORS middleware
func corsHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("Access-Control-Allow-Origin", "*")
		header.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		header.Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// JSON response with buffer pool
var jsonBufferPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 1024))
	},
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	buf := jsonBufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer jsonBufferPool.Put(buf)

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(buf).Encode(data); err != nil {
		http.Error(w, "JSON encoding error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(status)
	if _, err := io.Copy(w, buf); err != nil {
		log.Printf("Error writing response: %v", err)
	}
}

func sendError(w http.ResponseWriter, status int, message string) {
	sendJSON(w, status, map[string]string{"error": message})
}

// closeFile is a helper to handle file closing with error logging
func closeFile(f io.Closer, name string) {
	if err := f.Close(); err != nil {
		log.Printf("Error closing %s: %v", name, err)
	}
}

// Optimized PDF text extraction
func extractPDFText(filePath string) (string, error) {
	file, reader, err := pdf.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}
	defer closeFile(file, filePath)

	numPages := reader.NumPage()
	if numPages == 0 {
		return "", fmt.Errorf("PDF has no pages")
	}

	var text strings.Builder
	text.Grow(numPages * 2000)

	for i := 1; i <= numPages; i++ {
		page := reader.Page(i)
		if page.V.IsNull() {
			continue
		}

		pageText, err := page.GetPlainText(nil)
		if err != nil {
			// Fallback method
			content := page.Content()
			if content.Text != nil {
				for _, textObj := range content.Text {
					text.WriteString(textObj.S)
					text.WriteString(" ")
				}
				text.WriteString("\n")
			}
			continue
		}

		text.WriteString(pageText)
		text.WriteString("\n")
	}

	return text.String(), nil
}

func extractText(filePath string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))

	switch ext {
	case ".pdf":
		return extractPDFText(filePath)
	case ".txt", ".md":
		content, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}
		return string(content), nil
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

func chunkText(text string, chunkSize int) []string {
	if len(text) == 0 {
		return []string{}
	}

	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{text}
	}

	estimatedChunks := len(text) / chunkSize
	if estimatedChunks == 0 {
		estimatedChunks = 1
	}
	chunks := make([]string, 0, estimatedChunks)

	var currentChunk strings.Builder
	currentChunk.Grow(chunkSize + 100)
	currentSize := 0

	for _, word := range words {
		wordLen := len(word) + 1

		if currentSize+wordLen > chunkSize && currentChunk.Len() > 0 {
			chunks = append(chunks, strings.TrimSpace(currentChunk.String()))
			currentChunk.Reset()
			currentChunk.Grow(chunkSize + 100)
			currentSize = 0
		}

		if currentChunk.Len() > 0 {
			currentChunk.WriteString(" ")
		}
		currentChunk.WriteString(word)
		currentSize += wordLen
	}

	if currentChunk.Len() > 0 {
		chunks = append(chunks, strings.TrimSpace(currentChunk.String()))
	}

	return chunks
}

// Build word index for faster searching
func buildWordIndex(chunks []string) map[string][]int {
	wordIndex := make(map[string][]int)

	for i, chunk := range chunks {
		words := strings.Fields(strings.ToLower(chunk))
		wordSet := make(map[string]bool)

		// Deduplicate words in this chunk
		for _, word := range words {
			if !wordSet[word] {
				wordSet[word] = true
				wordIndex[word] = append(wordIndex[word], i)
			}
		}
	}

	return wordIndex
}

// Ollama call with connection limiting and timeout
func callOllama(prompt, model string) (string, error) {
	select {
	case <-ollamaLimiter:
		defer func() { ollamaLimiter <- struct{}{} }()
	case <-time.After(5 * time.Second):
		return "", fmt.Errorf("ollama service too busy")
	}

	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), RequestTimeout)
	defer cancel()

	reqBody := map[string]interface{}{
		"model":  model,
		"prompt": prompt,
		"stream": false,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", OllamaApi+"/generate", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: RequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama request failed: %w", err)
	}
	defer closeFile(resp.Body, "response body")

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama error: status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	response, ok := result["response"].(string)
	if !ok {
		return "", fmt.Errorf("invalid response format")
	}

	duration := time.Since(start)
	log.Printf("Ollama call completed in %v (model: %s)", duration, model)

	return response, nil
}

// document summarization
func generateDocumentSummary(doc *Document, modelName, summaryType string) (string, error) {
	doc.mu.RLock()
	text := doc.Text
	name := doc.Name
	doc.mu.RUnlock()

	var instructions string
	switch summaryType {
	case "Detailed":
		instructions = "Provide a detailed summary with key points and conclusions"
	case "Brief":
		instructions = "Provide a brief overview of the main points"
	default:
		instructions = "Summarize this document concisely"
	}

	// Truncate text if too long to avoid Ollama timeouts
	const maxTextLength = 6000
	if len(text) > maxTextLength {
		text = text[:maxTextLength] + "...[text truncated due to length]"
	}

	// Clean the text - remove excessive whitespace and newlines
	text = strings.Join(strings.Fields(text), " ")

	// Create a well-formatted prompt
	prompt := fmt.Sprintf("Task: %s\n\nDocument Content:\n%s\n\nPlease provide the summary:", instructions, text)

	log.Printf("Generating summary for %s (%d chars)", name, len(text))
	return callOllama(prompt, modelName)
}

// Get available models from Ollama with caching
var modelsCache struct {
	models    []string
	timestamp time.Time
	mu        sync.RWMutex
}

func getModels(w http.ResponseWriter, r *http.Request) {
	if !validateMethod(w, r, "GET") {
		return
	}

	// Check cache (valid for 5 minutes)
	modelsCache.mu.RLock()
	if time.Since(modelsCache.timestamp) < 5*time.Minute && len(modelsCache.models) > 0 {
		models := modelsCache.models
		modelsCache.mu.RUnlock()
		sendJSON(w, http.StatusOK, map[string]interface{}{"models": models})
		return
	}
	modelsCache.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", OllamaApi+"/tags", nil)
	if err != nil {
		sendError(w, http.StatusServiceUnavailable, "Failed to create request")
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		sendError(w, http.StatusServiceUnavailable, "Failed to connect to Ollama")
		return
	}
	defer closeFile(resp.Body, "models response body")

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		sendError(w, http.StatusServiceUnavailable, "Invalid response from Ollama")
		return
	}

	models := make([]string, 0)
	if modelList, ok := result["models"].([]interface{}); ok {
		for _, model := range modelList {
			if modelMap, ok := model.(map[string]interface{}); ok {
				if name, ok := modelMap["name"].(string); ok {
					models = append(models, name)
				}
			}
		}
	}

	// Update cache
	modelsCache.mu.Lock()
	modelsCache.models = models
	modelsCache.timestamp = time.Now()
	modelsCache.mu.Unlock()

	sendJSON(w, http.StatusOK, map[string]interface{}{"models": models})
}

func getDocuments(w http.ResponseWriter, r *http.Request) {
	if !validateMethod(w, r, "GET") {
		return
	}

	docsResponse := documentStore.List()
	sendJSON(w, http.StatusOK, map[string]interface{}{"documents": docsResponse})
}

// document processing
func processDocument(w http.ResponseWriter, r *http.Request) {
	if !validateMethod(w, r, "POST") {
		return
	}

	// Parse form with size limit
	if err := r.ParseMultipartForm(MaxRequestSize); err != nil {
		sendError(w, http.StatusBadRequest, "Failed to parse form or file too large")
		return
	}

	// Get file
	file, header, err := r.FormFile("file")
	if err != nil {
		sendError(w, http.StatusBadRequest, "No file uploaded")
		return
	}
	defer closeFile(file, "uploaded file")

	// Get form values with defaults
	chunkSizeStr := r.FormValue("chunkSize")
	generateSummaryStr := r.FormValue("generateSummary")
	modelName := r.FormValue("modelName")
	summaryType := r.FormValue("summaryType")

	chunkSize := DefaultChunkSize
	if chunkSizeStr != "" {
		if cs, err := strconv.Atoi(chunkSizeStr); err == nil && cs > 0 {
			chunkSize = cs
		}
	}

	generateSummary := generateSummaryStr == "true"

	// Save file
	filePath := filepath.Join("./documents", header.Filename)
	dst, err := os.Create(filePath)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to save file")
		return
	}
	defer closeFile(dst, filePath)

	if _, err := io.Copy(dst, file); err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to save file")
		return
	}

	// Extract text
	text, err := extractText(filePath)
	if err != nil {
		sendError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to extract text: %v", err))
		return
	}

	// Create chunks
	chunks := chunkText(text, chunkSize)

	// Build word index for fast searching
	wordIndex := buildWordIndex(chunks)

	// Create document
	doc := &Document{
		Name:        header.Filename,
		Text:        text,
		Chunks:      chunks,
		ChunkCount:  len(chunks),
		ContentSize: len(text),
		HasSummary:  false,
		CreatedAt:   time.Now(),
		textLower:   strings.ToLower(text),
		wordIndex:   wordIndex,
	}

	// Store document first
	documentStore.Set(header.Filename, doc)

	log.Printf("Processed %s: %d chunks, %d chars, %d indexed words",
		header.Filename, len(chunks), len(text), len(wordIndex))

	message := fmt.Sprintf("Document processed: %d chunks created", len(chunks))

	// Generate summary asynchronously if requested
	if generateSummary && modelName != "" {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("Panic in summary generation for %s: %v", header.Filename, r)
				}
			}()

			log.Printf("Starting async summary generation for %s", header.Filename)

			summary, err := generateDocumentSummary(doc, modelName, summaryType)
			if err != nil {
				log.Printf("Summary generation failed for %s: %v", header.Filename, err)
				return
			}

			// Ensure summary is not empty before updating
			if strings.TrimSpace(summary) == "" {
				log.Printf("Generated empty summary for %s", header.Filename)
				return
			}

			// Update document using the safe method
			if !documentStore.UpdateSummary(header.Filename, summary) {
				log.Printf("Failed to update summary for %s: document not found", header.Filename)
				return
			}

			log.Printf("Summary generation completed successfully for %s (length: %d)",
				header.Filename, len(summary))
		}()
		message += " (summary generating in background)"
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": message})
}

// validateMethod checks if the HTTP method is allowed
func validateMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return false
	}
	return true
}

// getDocumentOrError retrieves a document or sends an error response
func getDocumentOrError(w http.ResponseWriter, docName string) (*Document, bool) {
	doc, exists := documentStore.Get(docName)
	if !exists {
		sendError(w, http.StatusNotFound, "Document not found")
		return nil, false
	}
	return doc, true
}

// document querying with word index
func queryDocument(w http.ResponseWriter, r *http.Request) {
	if !validateMethod(w, r, "POST") {
		return
	}

	var req QueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request")
		return
	}

	doc, ok := getDocumentOrError(w, req.DocumentName)
	if !ok {
		return
	}

	doc.mu.RLock()
	defer doc.mu.RUnlock()

	// relevance scoring using word index
	queryWords := strings.Fields(strings.ToLower(req.Query))
	chunkScores := make(map[int]int)

	// Use word index for faster lookup
	for _, qWord := range queryWords {
		if chunkIndices, exists := doc.wordIndex[qWord]; exists {
			for _, chunkIdx := range chunkIndices {
				chunkScores[chunkIdx]++
			}
		}
	}

	// Convert to sorted slice
	type chunkScore struct {
		index int
		score int
		chunk string
	}

	scores := make([]chunkScore, 0, len(chunkScores))
	for idx, score := range chunkScores {
		scores = append(scores, chunkScore{idx, score, doc.Chunks[idx]})
	}

	// Sort by relevance (descending)
	sort.Slice(scores, func(i, j int) bool {
		return scores[i].score > scores[j].score
	})

	// Get top 3 chunks
	maxChunks := 3
	if len(scores) < maxChunks {
		maxChunks = len(scores)
	}

	topChunks := make([]string, 0, maxChunks)
	for i := 0; i < maxChunks; i++ {
		topChunks = append(topChunks, scores[i].chunk)
	}

	// Fallback to first chunks if no matches
	if len(topChunks) == 0 {
		maxChunks = 3
		if len(doc.Chunks) < maxChunks {
			maxChunks = len(doc.Chunks)
		}
		topChunks = doc.Chunks[:maxChunks]
	}

	// Build context
	ragContext := strings.Join(topChunks, "\n\n")
	usedSummary := false

	// Add summary if available
	if doc.HasSummary && doc.Summary != "" {
		ragContext = fmt.Sprintf("Summary: %s\n\nRelevant sections:\n%s", doc.Summary, ragContext)
		usedSummary = true
	}

	// Create prompt
	prompt := fmt.Sprintf(`Answer based on this context:

%s

Question: %s

Answer:`, ragContext, req.Query)

	// Get response from Ollama
	response, err := callOllama(prompt, req.ModelName)
	if err != nil {
		sendError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get response: %v", err))
		return
	}

	sendJSON(w, http.StatusOK, QueryResponse{
		Response:     response,
		SourceChunks: topChunks,
		UsedSummary:  usedSummary,
	})
}

func summarizeDocument(w http.ResponseWriter, r *http.Request) {
	if !validateMethod(w, r, "POST") {
		return
	}

	var req SummarizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request")
		return
	}

	doc, ok := getDocumentOrError(w, req.DocumentName)
	if !ok {
		return
	}

	summary, err := generateDocumentSummary(doc, req.ModelName, req.SummaryType)
	if err != nil {
		sendError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to generate summary: %v", err))
		return
	}

	doc.mu.Lock()
	doc.Summary = summary
	doc.HasSummary = true
	doc.mu.Unlock()

	sendJSON(w, http.StatusOK, map[string]string{"summary": summary})
}

func handleDocumentByName(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/document/")
	parts := strings.Split(path, "/")

	if len(parts) < 1 {
		sendError(w, http.StatusBadRequest, "Invalid URL")
		return
	}

	docName := parts[0]

	if len(parts) == 2 && parts[1] == "summary" {
		handleGetDocumentSummary(w, r, docName)
	} else if len(parts) == 1 {
		handleDeleteDocument(w, r, docName)
	} else {
		sendError(w, http.StatusNotFound, "Not found")
	}
}

func handleGetDocumentSummary(w http.ResponseWriter, r *http.Request, docName string) {
	if !validateMethod(w, r, "GET") {
		return
	}

	doc, ok := getDocumentOrError(w, docName)
	if !ok {
		return
	}

	// Use the safe method
	hasSummary, summary := doc.GetSummaryStatus()

	if !hasSummary || summary == "" {
		sendError(w, http.StatusNotFound, "No summary available")
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"summary": summary})
}

func handleDeleteDocument(w http.ResponseWriter, r *http.Request, docName string) {
	if !validateMethod(w, r, "DELETE") {
		return
	}

	if !documentStore.Delete(docName) {
		sendError(w, http.StatusNotFound, "Document not found")
		return
	}

	// Clean up file
	if err := os.Remove(filepath.Join("./documents", docName)); err != nil {
		log.Printf("Warning: failed to delete file %s: %v", docName, err)
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": "Document deleted"})
}
