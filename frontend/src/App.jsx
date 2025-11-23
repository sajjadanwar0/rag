import React, { useState, useEffect } from 'react';
import {
    Upload,
    MessageCircle,
    BarChart3,
    AlertCircle,
    CheckCircle,
    Loader2,
    Download,
    Trash2,
    RefreshCw,
    Clock
} from 'lucide-react';
import remarkGfm from "remark-gfm";
import ReactMarkdown from 'react-markdown';

const API_URL = 'http://localhost:8080/api';

const App = () => {
    const [activeTab, setActiveTab] = useState('upload');
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [documents, setDocuments] = useState({});
    const [selectedDocument, setSelectedDocument] = useState('');
    const [file, setFile] = useState(null);
    const [chunkSize, setChunkSize] = useState(512);
    const [generateSummary, setGenerateSummary] = useState(true);
    const [summaryType, setSummaryType] = useState('Standard');
    const [query, setQuery] = useState('');
    const [queryResponse, setQueryResponse] = useState(null);
    const [summary, setSummary] = useState('');
    const [conversation, setConversation] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [summaryGenerating, setSummaryGenerating] = useState(false);

    // Timing states
    const [processingTime, setProcessingTime] = useState(null);
    const [queryTime, setQueryTime] = useState(null);
    const [summaryTime, setSummaryTime] = useState(null);
    const [summaryStartTime, setSummaryStartTime] = useState(null);

    // Initialize app
    useEffect(() => {
        const initApp = async () => {
            // Fetch models
            try {
                const response = await fetch(`${API_URL}/models`);
                const data = await response.json();

                if (data.models) {
                    setModels(data.models);
                    if (data.models.length > 0) {
                        setSelectedModel(data.models[0]);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch models:', err);
                setError('Failed to connect to Ollama. Make sure it\'s running on localhost:11434');
            }

            // Fetch documents
            try {
                const response = await fetch(`${API_URL}/documents`);
                const data = await response.json();
                setDocuments(data.documents || {});
            } catch (err) {
                console.error('Failed to fetch documents:', err);
            }
        };

        initApp();
    }, []);

    // Auto-refresh documents when summary is generating
    useEffect(() => {
        if (!summaryGenerating) return;

        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_URL}/documents`);
                const data = await response.json();
                const newDocuments = data.documents || {};

                setDocuments(prevDocuments => {
                    // Check for newly completed summaries
                    if (summaryStartTime) {
                        Object.keys(newDocuments).forEach(docName => {
                            if (newDocuments[docName]?.hasSummary &&
                                (!prevDocuments[docName] || !prevDocuments[docName].hasSummary)) {
                                const endTime = Date.now();
                                const summaryDuration = ((endTime - summaryStartTime) / 1000).toFixed(1);
                                setSuccess(`Summary generated for ${docName} in ${summaryDuration}s!`);
                                setSummaryGenerating(false);
                                setSummaryStartTime(null);
                            }
                        });
                    }

                    return newDocuments;
                });
            } catch (err) {
                console.error('Failed to fetch documents:', err);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [summaryGenerating, summaryStartTime]);

    // Load summary when document is selected
    useEffect(() => {
        const loadSummary = async () => {
            if (selectedDocument && documents[selectedDocument]?.hasSummary) {
                try {
                    const response = await fetch(`${API_URL}/document/${selectedDocument}/summary`);

                    if (response.ok) {
                        const data = await response.json();
                        setSummary(data.summary);
                    }
                } catch (err) {
                    console.error('Failed to fetch summary:', err);
                }
            } else {
                setSummary('');
            }
        };

        loadSummary();
    }, [selectedDocument, documents]);

    const refreshDocuments = async () => {
        try {
            const response = await fetch(`${API_URL}/documents`);
            const data = await response.json();
            setDocuments(data.documents || {});
        } catch (err) {
            console.error('Failed to fetch documents:', err);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setError('Please select a file first');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');
        setProcessingTime(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('chunkSize', chunkSize.toString());
        formData.append('generateSummary', generateSummary.toString());
        formData.append('modelName', selectedModel);
        formData.append('summaryType', summaryType);

        const startTime = Date.now();

        try {
            const response = await fetch(`${API_URL}/document/process`, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setProcessingTime(duration);

            if (response.ok) {
                setSuccess(`${data.message} (Processed in ${duration}s)`);
                if (generateSummary) {
                    setSummaryGenerating(true);
                    setSummaryStartTime(Date.now());

                    // Stop summary generation automatically after 5 minutes (safety net)
                    setTimeout(() => {
                        setSummaryGenerating(false);
                        setSummaryStartTime(null);
                    }, 300000); // 5 minutes
                }

                // Auto-select uploaded document
                setSelectedDocument(file.name);
                setFile(null);

                // Refresh documents
                await refreshDocuments();

                // Switch to questions tab
                setTimeout(() => setActiveTab('questions'), 2000);
            } else {
                setError(data.error || 'Failed to process document');
            }
        } catch (err) {
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setProcessingTime(duration);
            setError(`Failed to upload document (${duration}s)`);
        } finally {
            setLoading(false);
        }
    };

    const handleQuery = async () => {
        if (!query.trim() || !selectedDocument) {
            setError('Please enter a question and select a document');
            return;
        }

        setLoading(true);
        setError('');
        setQueryTime(null);

        const startTime = Date.now();

        try {
            const response = await fetch(`${API_URL}/document/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    documentName: selectedDocument,
                    query: query,
                    modelName: selectedModel,
                }),
            });

            const data = await response.json();
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setQueryTime(duration);

            if (response.ok) {
                setQueryResponse({ ...data, responseTime: duration });
                setConversation(prev => [...prev, {
                    question: query,
                    answer: data.response,
                    responseTime: duration,
                    timestamp: new Date().toLocaleTimeString()
                }]);
                setQuery('');
            } else {
                setError(data.error || 'Failed to query document');
            }
        } catch (err) {
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setQueryTime(duration);
            setError(`Failed to query document (${duration}s)`);
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = async () => {
        if (!selectedDocument) {
            setError('Please select a document');
            return;
        }

        setLoading(true);
        setError('');
        setSummaryTime(null);

        const startTime = Date.now();

        try {
            const response = await fetch(`${API_URL}/document/summarize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    documentName: selectedDocument,
                    modelName: selectedModel,
                    summaryType: summaryType,
                }),
            });

            const data = await response.json();
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setSummaryTime(duration);

            if (response.ok) {
                setSummary(data.summary);
                setSuccess(`Summary generated successfully in ${duration}s!`);
                refreshDocuments();
            } else {
                setError(data.error || 'Failed to generate summary');
            }
        } catch (err) {
            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            setSummaryTime(duration);
            setError(`Failed to generate summary (${duration}s)`);
        } finally {
            setLoading(false);
        }
    };

    const deleteDocument = async (docName) => {
        if (!window.confirm(`Are you sure you want to delete ${docName}?`)) return;

        const startTime = Date.now();

        try {
            const response = await fetch(`${API_URL}/document/${docName}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                const endTime = Date.now();
                const duration = ((endTime - startTime) / 1000).toFixed(1);
                setSuccess(`Document ${docName} deleted (${duration}s)`);
                if (selectedDocument === docName) {
                    setSelectedDocument('');
                    setQueryResponse(null);
                    setSummary('');
                    setConversation([]);
                }

                refreshDocuments();
            }
        } catch (err) {
            setError('Failed to delete document');
        }
    };

    const downloadSummary = () => {
        if (!summary) return;
        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedDocument.replace(/\.[^/.]+$/, '')}_summary.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Helper component for timing display
    const TimingBadge = ({ time, label }) => {
        return time ? (
            <div className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 text-sky-700 rounded-md text-xs font-medium mr-1">
                <Clock className="w-3.5 h-3.5" />
                <span>{label}: {time}s</span>
            </div>
        ) : null;
    };

    const Alert = ({ type, children, onClose }) => (
        <div className={`
      p-4 rounded-md mb-4 flex justify-between items-center border
      ${type === 'error' ? 'bg-red-50 text-red-800 border-red-200' :
            type === 'success' ? 'bg-green-50 text-green-800 border-green-200' :
                'bg-blue-50 text-blue-800 border-blue-200'}
    `}>
            <div className="flex items-center gap-2">
                {type === 'error' && <AlertCircle className="w-5 h-5" />}
                {type === 'success' && <CheckCircle className="w-5 h-5" />}
                <span>{children}</span>
            </div>
            {onClose && (
                <button
                    onClick={onClose}
                    className="bg-transparent border-none text-xl cursor-pointer opacity-70 hover:opacity-100"
                >
                    ×
                </button>
            )}
        </div>
    );

    const Button = ({ variant = 'primary', size = 'medium', disabled, loading, children, onClick, className, ...props }) => {
        const baseClasses = "inline-flex items-center gap-2 rounded-md font-medium transition-all border-0 outline-none";
        const sizeClasses = size === 'small' ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-base';
        const variantClasses = variant === 'primary'
            ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
            : variant === 'outline'
                ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100'
                : 'bg-gray-500 text-white hover:bg-gray-600 disabled:bg-gray-400';
        const disabledClasses = (disabled || loading) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer';

        return (
            <button
                className={`${baseClasses} ${sizeClasses} ${variantClasses} ${disabledClasses} ${className || ''}`}
                disabled={disabled || loading}
                onClick={onClick}
                {...props}
            >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {children}
            </button>
        );
    };

    const Input = ({ label, className, ...props }) => (
        <div className="mb-4">
            {label && <label className="block mb-2 font-medium text-gray-800">{label}</label>}
            <input
                className={`w-full px-3 py-3 border border-gray-300 rounded-md text-base transition-colors outline-none focus:border-blue-500 font-sans ${className || ''}`}
                {...props}
            />
        </div>
    );

    const Select = ({ label, children, className, ...props }) => (
        <div className="mb-4">
            {label && <label className="block mb-2 font-medium text-gray-800">{label}</label>}
            <select
                className={`w-full px-3 py-3 border border-gray-300 rounded-md text-base transition-colors outline-none focus:border-blue-500 font-sans ${className || ''}`}
                {...props}
            >
                {children}
            </select>
        </div>
    );

    const Card = ({ title, children, className, ...props }) => (
        <div className={`bg-white rounded-lg p-6 mb-4 shadow-sm ${className || ''}`} {...props}>
            {title && <h3 className="m-0 mb-4 text-gray-800 text-xl font-semibold">{title}</h3>}
            {children}
        </div>
    );

    const Expander = ({ title, children, defaultOpen = false }) => {
        const [open, setOpen] = useState(defaultOpen);
        return (
            <div className="border border-gray-200 rounded-md mb-4">
                <button
                    className="w-full p-3 bg-gray-50 border-none text-left cursor-pointer flex justify-between items-center font-medium hover:bg-gray-100"
                    onClick={() => setOpen(!open)}
                >
                    <span>{title}</span>
                    <span className={`transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}>▼</span>
                </button>

                {open && (
                    <div className="p-4 border-t border-gray-200">
                        {children}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-7xl mx-auto p-8 font-sans bg-gray-50 min-h-screen">
            <div className="text-center mb-8 text-gray-800">
                <h1 className="text-4xl m-0 font-semibold mb-2">
                    Document RAG System
                </h1>
                <p className="text-gray-600 m-0">
                    Upload, analyze, and chat with your documents
                </p>
            </div>

            {/* Sidebar - Settings */}
            <div className="bg-white rounded-lg p-6 mb-8 shadow-sm">
                <h3 className="m-0 mb-4 text-gray-800 text-xl font-semibold">
                    Settings
                </h3>
                <div className="grid md:grid-cols-2 grid-cols-1 gap-4">
                    <Select
                        label="Model"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                    >
                        {models.map(model => (
                            <option key={model} value={model}>{model}</option>
                        ))}
                    </Select>

                    <div className="flex items-center gap-2">
                        <Select
                            label="Document"
                            value={selectedDocument}
                            onChange={(e) => setSelectedDocument(e.target.value)}
                        >
                            <option value="">Select a document...</option>
                            {Object.entries(documents).map(([name, doc]) => (
                                <option key={name} value={name}>
                                    {name} {doc.hasSummary ? '' : ''}
                                </option>
                            ))}
                        </Select>
                        <Button
                            variant="outline"
                            size="small"
                            onClick={refreshDocuments}
                            className="mt-7"
                        >
                            <RefreshCw size={16} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Alerts */}
            {summaryGenerating && (
                <div className="p-4 rounded-md mb-4 bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Summary is being generated in the background...
                    {summaryStartTime && (
                        <TimingBadge
                            time={((Date.now() - summaryStartTime) / 1000).toFixed(0)}
                            label="Elapsed"
                        />
                    )}
                    <button
                        onClick={() => {
                            setSummaryGenerating(false);
                            setSummaryStartTime(null);
                        }}
                        className="ml-auto text-blue-600 hover:text-blue-800 text-sm underline"
                    >
                        Stop checking
                    </button>
                </div>
            )}

            {error && (
                <Alert type="error" onClose={() => setError('')}>
                    {error}
                </Alert>
            )}

            {success && (
                <Alert type="success" onClose={() => setSuccess('')}>
                    {success}
                </Alert>
            )}

            {/* Main Tabs */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="flex border-b border-gray-100">
                    {[
                        { key: 'upload', label: 'Upload & Process', icon: Upload },
                        { key: 'questions', label: 'Ask Questions', icon: MessageCircle },
                        { key: 'summarize', label: 'Summarize', icon: BarChart3 }
                    ].map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            className={`flex-1 p-4 border-0 cursor-pointer font-medium transition-all flex items-center justify-center gap-2 ${
                                activeTab === key
                                    ? 'bg-white text-red-500 border-b-2 border-red-500 border-solid'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-50'
                            }`}
                            onClick={() => setActiveTab(key)}
                        >
                            <Icon className="w-5 h-5" />
                            {label}
                        </button>
                    ))}
                </div>

                <div className="p-8">
                    {/* Upload Tab */}
                    {activeTab === 'upload' && (
                        <div>
                            <h2 className="text-2xl font-semibold mb-6">Upload & Process Document</h2>

                            <div
                                className={`
                  border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all mb-4
                  ${file ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'}
                `}
                                onClick={() => document.getElementById('file-input').click()}
                            >
                                <Upload className="w-12 h-12 opacity-50 mb-4 mx-auto" />
                                <div>
                                    {file ? (
                                        <>
                                            <div className="font-semibold">{file.name}</div>
                                            <div className="mt-2 text-sm text-gray-600">
                                                Size: {(file.size / 1024 / 1024).toFixed(2)} MB
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="font-semibold">Click to upload document</div>
                                            <div className="mt-2 text-sm text-gray-600">
                                                Supports PDF, TXT, MD files
                                            </div>
                                        </>
                                    )}
                                </div>
                                <input
                                    id="file-input"
                                    type="file"
                                    accept=".pdf,.txt,.md"
                                    onChange={(e) => setFile(e.target.files[0])}
                                    className="hidden"
                                />
                            </div>

                            <Input
                                label="Chunk Size"
                                type="number"
                                value={chunkSize}
                                onChange={(e) => setChunkSize(parseInt(e.target.value))}
                                min="256"
                                max="1024"
                                step="64"
                            />

                            <div className="mb-4">
                                <label className="flex items-center gap-2 font-medium text-gray-800">
                                    <input
                                        type="checkbox"
                                        checked={generateSummary}
                                        onChange={(e) => setGenerateSummary(e.target.checked)}
                                    />
                                    Generate summary during processing
                                </label>
                            </div>

                            {generateSummary && (
                                <Select
                                    label="Summary Type"
                                    value={summaryType}
                                    onChange={(e) => setSummaryType(e.target.value)}
                                >
                                    <option value="Standard">Standard</option>
                                    <option value="Detailed">Detailed</option>
                                    <option value="Brief">Brief</option>
                                </Select>
                            )}

                            <Button
                                variant="primary"
                                onClick={handleUpload}
                                disabled={!file || !selectedModel}
                                loading={loading}
                            >
                                <Upload className="w-5 h-5" />
                                Process Document
                            </Button>

                            {/* Processing time display */}
                            {(loading || processingTime) && (
                                <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md my-2">
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Processing document...</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            <span>Document processed successfully!</span>
                                            <TimingBadge time={processingTime} label="Processing time" />
                                        </>
                                    )}
                                </div>
                            )}

                            {selectedDocument && documents[selectedDocument] && (
                                <Card title={`Recently Uploaded: ${selectedDocument}`}>
                                    <div className="text-sm text-gray-600 mb-4">
                                        Chunks: {documents[selectedDocument].chunkCount} |
                                        Size: {Math.round(documents[selectedDocument].contentSize / 1024)} KB
                                    </div>

                                    {documents[selectedDocument].hasSummary ? (
                                        summary ? (
                                            <div>
                                                <div className="flex justify-between items-center mb-4">
                                                    <h4 className="text-lg font-semibold">Document Summary</h4>
                                                    <Button size="small" onClick={downloadSummary}>
                                                        <Download className="w-4 h-4" />
                                                        Download
                                                    </Button>
                                                </div>
                                                <div className="bg-gray-50 border border-gray-200 rounded-md p-4 max-h-96 overflow-y-auto prose prose-sm max-w-none">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {summary}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Loading summary...
                                            </div>
                                        )
                                    ) : summaryGenerating ? (
                                        <div className="flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Summary is being generated...
                                        </div>
                                    ) : (
                                        <div>No summary available. Generate one in the "Summarize" tab.</div>
                                    )}

                                    <div className="flex gap-2 mt-4">
                                        <Button variant="primary" onClick={() => setActiveTab('questions')}>
                                            <MessageCircle className="w-4 h-4" />
                                            Ask Questions
                                        </Button>
                                        <Button variant="outline" onClick={() => setActiveTab('summarize')}>
                                            <BarChart3 className="w-4 h-4" />
                                            View Summary
                                        </Button>
                                    </div>
                                </Card>
                            )}

                        </div>
                    )}

                    {/* Ask Questions Tab */}
                    {activeTab === 'questions' && (
                        <div>
                            <h2 className="text-2xl font-semibold mb-6">Ask Questions About Your Document</h2>

                            {!selectedDocument ? (
                                <div className="text-center py-12 text-gray-600">
                                    <h3 className="mb-2 text-gray-700 text-xl">Please select a document first</h3>
                                    <p>Upload a document or select from the dropdown above</p>
                                </div>
                            ) : (
                                <>
                                    {documents[selectedDocument]?.hasSummary && summary && (
                                        <Card>
                                            <div className="flex justify-between items-center mb-4">
                                                <h4 className="text-lg font-semibold">Document Summary</h4>
                                                <Button size="small" onClick={downloadSummary}>
                                                    <Download className="w-4 h-4" />
                                                    Download
                                                </Button>
                                            </div>
                                            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 max-h-36 overflow-y-auto prose prose-sm max-w-none">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {summary.length > 300 ? `${summary.substring(0, 300)}...` : summary}
                                                </ReactMarkdown>
                                            </div>
                                            {summary.length > 300 && (
                                                <p className="text-sm text-gray-600 mt-2">
                                                    View full summary in the "Summarize" tab
                                                </p>
                                            )}
                                        </Card>
                                    )}

                                    <div className="mb-4">
                                        <label className="block mb-2 font-medium text-gray-800">Enter your question</label>
                                        <textarea
                                            className="w-full px-3 py-3 border border-gray-300 rounded-md text-base transition-colors min-h-[100px] resize-y outline-none focus:border-blue-500 leading-6 font-sans"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="e.g., What are the main topics discussed in this document?"
                                        />
                                    </div>

                                    <Button
                                        variant="primary"
                                        onClick={handleQuery}
                                        disabled={!query.trim() || loading}
                                        loading={loading}
                                        className="mb-4"
                                    >
                                        <MessageCircle className="w-5 h-5" />
                                        Get Answer
                                    </Button>

                                    {/* Query time display */}
                                    {(loading || queryTime) && (
                                        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md my-2">
                                            {loading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span>Getting answer...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                                    <span>Answer generated!</span>
                                                    <TimingBadge time={queryTime} label="Response time" />
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {queryResponse && (
                                        <Card title="Answer">
                                            <div className="whitespace-pre-wrap mb-4">
                                                {queryResponse.response}
                                            </div>

                                            <div className="mb-4">
                                                <TimingBadge time={queryResponse.responseTime} label="Response time" />
                                                {queryResponse.usedSummary && (
                                                    <div className="inline-flex items-center px-2 py-1 bg-green-500 text-white rounded-full text-xs font-medium ml-2">
                                                        Document summary was used
                                                    </div>
                                                )}
                                            </div>

                                            <Expander title={`View Source Chunks (${queryResponse.sourceChunks?.length || 0})`}>
                                                {queryResponse.sourceChunks?.map((chunk, i) => (
                                                    <div key={i} className="mb-4">
                                                        <h4 className="font-semibold mb-2">Chunk {i + 1}</h4>
                                                        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 max-h-48 overflow-y-auto whitespace-pre-wrap">
                                                            {chunk.length > 300 ? `${chunk.substring(0, 300)}...` : chunk}
                                                        </div>
                                                    </div>
                                                ))}
                                            </Expander>
                                        </Card>
                                    )}

                                    {conversation.length > 0 && (
                                        <Card>
                                            <div className="flex justify-between items-center mb-4">
                                                <h4 className="text-lg font-semibold">Conversation History</h4>
                                                <Button
                                                    size="small"
                                                    variant="outline"
                                                    onClick={() => setConversation([])}
                                                >
                                                    Clear
                                                </Button>
                                            </div>

                                            {conversation.map((exchange, i) => (
                                                <Expander
                                                    key={i}
                                                    title={`Q${i+1}: ${exchange.question.length > 50 ? exchange.question.substring(0, 50) + '...' : exchange.question}`}
                                                    defaultOpen={i === conversation.length - 1}
                                                >
                                                    <div className="mb-2 text-xs text-gray-600">
                                                        <div className="flex justify-between items-center">
                                                            <span>{exchange.timestamp}</span>
                                                            <div className="flex items-center gap-1">
                                                                <Clock className="w-3 h-3" />
                                                                <span>{exchange.responseTime}s</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-gray-600 whitespace-pre-wrap">
                                                        {exchange.answer}
                                                    </div>
                                                </Expander>
                                            ))}
                                        </Card>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Summarize Tab */}
                    {activeTab === 'summarize' && (
                        <div>
                            <h2 className="text-2xl font-semibold mb-6">Document Summary</h2>

                            {!selectedDocument ? (
                                <div className="text-center py-12 text-gray-600">
                                    <h3 className="mb-2 text-gray-700 text-xl">Please select a document first</h3>
                                    <p>Upload a document or select from the dropdown above</p>
                                </div>
                            ) : (
                                <>
                                    {documents[selectedDocument]?.hasSummary && summary && (
                                        <Card>
                                            <div className="flex justify-between items-center mb-4">
                                                <h4 className="text-lg font-semibold">Current Summary</h4>
                                                <Button variant="outline" onClick={downloadSummary}>
                                                    <Download className="w-4 h-4" />
                                                    Download
                                                </Button>
                                            </div>
                                            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 max-h-96 overflow-y-auto prose prose-sm max-w-none">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {summary}
                                                </ReactMarkdown>
                                            </div>
                                        </Card>
                                    )}

                                    <Select
                                        label="Summary Type"
                                        value={summaryType}
                                        onChange={(e) => setSummaryType(e.target.value)}
                                    >
                                        <option value="Standard">Standard</option>
                                        <option value="Detailed">Detailed</option>
                                        <option value="Brief">Brief</option>
                                    </Select>

                                    <Button
                                        variant="primary"
                                        onClick={handleSummarize}
                                        disabled={loading}
                                        loading={loading}
                                    >
                                        <BarChart3 className="w-5 h-5" />
                                        {loading
                                            ? 'Generating Summary...'
                                            : documents[selectedDocument]?.hasSummary
                                                ? 'Regenerate Summary'
                                                : 'Generate Summary'
                                        }
                                    </Button>

                                    {/* Summary time display */}
                                    {(loading || summaryTime) && (
                                        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md my-2">
                                            {loading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span>Generating summary...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                                    <span>Summary generated!</span>
                                                    <TimingBadge time={summaryTime} label="Generation time" />
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {!documents[selectedDocument]?.hasSummary && (
                                        <p className="text-sm text-gray-600 mt-4 italic">
                                            This document doesn't have a summary yet. Generate one to get a quick overview of the content.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Document List */}
            {Object.keys(documents).length > 0 && (
                <div className="bg-white rounded-lg p-6 mt-8 shadow-sm">
                    <h3 className="m-0 mb-4 text-gray-800 text-xl font-semibold">
                        Uploaded Documents ({Object.keys(documents).length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(documents).map(([name, doc]) => (
                            <div
                                key={name}
                                className={`
                  rounded-md p-4 cursor-pointer transition-all
                  ${selectedDocument === name
                                    ? 'border-2 border-red-500 shadow-md shadow-red-100'
                                    : 'border border-gray-200 hover:border-gray-300'
                                }
                `}
                                onClick={() => setSelectedDocument(name)}
                            >
                                <div className="font-semibold mb-2 break-words">
                                    {name}
                                </div>
                                <div className="text-sm text-gray-600 mb-4">
                                    Chunks: {doc.chunkCount} | Size: {Math.round(doc.contentSize / 1024)} KB
                                    {doc.hasSummary && (
                                        <div className="inline-flex items-center px-2 py-1 bg-green-500 text-white rounded-full text-xs font-medium mt-2 ml-2">
                                            Summarized
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="small"
                                        variant={selectedDocument === name ? "primary" : "outline"}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedDocument(name);
                                        }}
                                    >
                                        {selectedDocument === name ? "Selected" : "Select"}
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="outline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteDocument(name);
                                        }}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {Object.keys(documents).length === 0 && (
                <div className="text-center py-12 text-gray-600">
                    <p>Upload your first document to get started with RAG!</p>
                    <Button
                        variant="primary"
                        onClick={() => setActiveTab('upload')}
                        className="mt-4"
                    >
                        <Upload className="w-5 h-5" />
                        Upload Document
                    </Button>
                </div>
            )}
        </div>
    );
};

export default App;