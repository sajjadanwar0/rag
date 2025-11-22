# Document RAG System

A Retrieval-Augmented Generation (RAG) system that allows you to upload documents, generate intelligent summaries, and have conversations with your documents using local models via Ollama.

![RAG System](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white)

## Features

- **Multiple Format Support**: Upload PDF, TXT, and MD files
- **Local AI Processing**: Uses Ollama for completely local LLM inference
- **Intelligent Q&A**: Ask questions about your documents with context-aware responses
- **Smart Summarization**: Generate brief, standard, or detailed summaries
- **Semantic Search**: Advanced word indexing and relevance scoring for accurate answers
- **Real-time Processing**: Async summary generation with live status updates
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS
- **Performance Metrics**: Track processing, query, and summary generation times
- **Document Management**: Easy upload, selection, and deletion of documents

## Quick Start

### Prerequisites

- **Node.js** v18+ ([Download](https://nodejs.org/))
- **Go** v1.21+ ([Download](https://go.dev/dl/))
- **Ollama** ([Download](https://ollama.com/download))

### Install Ollama

#### Linux/macOS:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### Windows:
Download from [ollama.com/download/windows](https://ollama.com/download/windows)

#### Verify Installation:
```bash
ollama --version
```

### Pull AI Models
```bash
# Check existing models
ollama list

# Pull recommended models
ollama pull gemma3:1b          # Fast, lightweight (Recommended for fast response)
ollama pull llama3.2:3b        # Balanced performance (2GB)
ollama pull mistral:7b         # Best quality (4GB)
ollama pull qwen2.5:3b         # Fast and efficient (2GB)
```

**Recommendation**: Start with `llama3.2:3b` for the best balance of speed and quality.

### Start Ollama Service
```bash
ollama serve
```

Verify it's running:
```bash
curl http://localhost:11434/api/tags
```

### Set Up Backend
```bash
# Clone the repo
cd rag

# Set up Go backend
cd backend

# Install dependencies
go get github.com/ledongthuc/pdf
go mod tidy
go mod download

# Create documents directory
mkdir documents

# Run the backend
go run main.go
```

**Expected output:**
```
Server starting on http://localhost:8080
```

### Set Up Frontend

Open a new terminal:
```bash
cd ../frontend

# Install dependencies
npm install

#### Run Frontend
```bash
npm run dev
```

**Expected output:**
```
VITE v5.x.x  ready in xxx ms
 Local:   http://localhost:5173/
```

### Access the Application

Open your browser and navigate to:
```
http://localhost:5173
```

## Usage Guide

### Uploading Documents

1. Click on the **"Upload & Process"** tab
2. Click the upload area or drag and drop your file (PDF, TXT, or MD)
3. Configure settings:
   - **Chunk Size**: 256-1024 (default: 512)
   - **Generate Summary**: Enable for automatic summarization
   - **Summary Type**: Brief, Standard, or Detailed
4. Click **"Process Document"**
5. Wait for processing to complete (typically 2-10 seconds)

### Asking Questions

1. Select a document from the dropdown
2. Navigate to **"Ask Questions"** tab
3. Type your question in the text area
4. Click **"Get Answer"**
5. View the AI-generated response with:
   - Source chunks used
   - Response time metrics
   - Conversation history

### Generating Summaries

1. Select a document
2. Navigate to **"Summarize"** tab
3. Choose summary type:
   - **Brief**: Quick overview
   - **Standard**: Balanced summary
   - **Detailed**: Comprehensive analysis
4. Click **"Generate Summary"**
5. Download the summary as a text file if needed

## Configuration

### Backend Settings

Located in `backend/main.go`:
```go
const (
    OllamaApi           = "http://localhost:11434/api"
    MaxRequestSize      = 32 << 20 // 32MB
    DefaultChunkSize    = 512
    MaxConcurrentOllama = 5
    RequestTimeout      = 30 * time.Second
)
```

### Frontend Settings

Located in `frontend/src/App.jsx`:
```javascript
const API_URL = 'http://localhost:8080/api';
```

## API Endpoints

### Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/models` | List available Ollama models |
| GET | `/api/documents` | List all uploaded documents |
| POST | `/api/document/process` | Upload and process a document |
| POST | `/api/document/query` | Query a document with a question |
| POST | `/api/document/summarize` | Generate document summary |
| GET | `/api/document/{name}/summary` | Retrieve document summary |
| DELETE | `/api/document/{name}` | Delete a document |

### Example Requests

#### Upload Document
```bash
curl -X POST http://localhost:8080/api/document/process \
  -F "file=@document.pdf" \
  -F "chunkSize=512" \
  -F "generateSummary=true" \
  -F "modelName=llama3.2:3b" \
  -F "summaryType=Standard"
```

#### Query Document
```bash
curl -X POST http://localhost:8080/api/document/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentName": "document.pdf",
    "query": "What are the main topics?",
    "modelName": "llama3.2:3b"
  }'
```

## Performance Optimization

### Model Selection

| Model | Size |    RAM | Speed | Quality | Use Case |
|-------|------------   |-----|-------|---------|----------|
| gemma3:1b |1-2GB | 4GB | Fast | Medium | Quick answers |
| llama3.2:3b | 2GB | 6GB | Low | Medium | Balanced |
| mistral:7b | 4GB | 8GB | Lowest | Best | Best quality |
| qwen2.5:3b | 2GB | 6GB | Lowest | Medium | Fast & efficient |

### Chunk Size Guidelines

- **256 tokens**: Short documents, fast processing
- **512 tokens**: Default, good balance
- **1024 tokens**: Long documents, better context

## Troubleshooting

### Ollama Not Connecting
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# If not running, start it
ollama serve

# Check if models are available
ollama list
```

### CORS Errors

The backend has CORS configured. Ensure:
- Backend is running on port 8080
- Frontend is accessing `http://localhost:8080/api`

### Model Not Found
```bash
# List available models
ollama list

# Pull the missing model
ollama pull llama3.2:3b
```

### Go Dependencies Issues
```bash
cd backend
go mod tidy
go mod download
```

### React Build Issues
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use

#### Backend (8080):
```bash
# Linux/macOS
lsof -ti:8080 | xargs kill -9

# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```

#### Frontend (5173):
```bash
# Change port in package.json
"dev": "vite --port 3000"
```

### Environment Variables
```bash
# Backend
export OLLAMA_API=http://localhost:11434/api
export PORT=8080

# Frontend
export VITE_API_URL=http://your-backend-url/api
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- [Ollama](https://ollama.com/) - Local LLM inference
- [React](https://react.dev/) - UI framework
- [Go](https://go.dev/) - Backend language
- [Vite](https://vitejs.dev/) - Frontend build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Lucide Icons](https://lucide.dev/) - Icon library

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation
- Review troubleshooting section
