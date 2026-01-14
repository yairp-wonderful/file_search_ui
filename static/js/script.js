// ============================================================================
// State Management
// ============================================================================
const state = {
    files: [],
    stores: [],
    storesAll: [],
    storesAllLoaded: false,
    storePage: 1,
    storePageSize: 10,
    storePageTokens: { 1: null },
    storeHasNext: false,
    storeTotalPages: 1,
    showAllStores: false,
    storeDocumentPage: 1,
    storeDocumentPageSize: 10,
    storeDocumentPageTokens: { 1: null },
    storeDocumentHasNext: false,
    storeDocumentStoreName: null,
    storeDocumentDisplayName: null,
    selectedStoreId: null,
    currentTab: 'upload'
};

// ============================================================================
// DOM Elements
// ============================================================================
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadStatus = document.getElementById('uploadStatus');
const filesList = document.getElementById('filesList');
const fileCheckboxList = document.getElementById('fileCheckboxList');
const searchQuery = document.getElementById('searchQuery');
const metadataFilterInput = document.getElementById('metadataFilter');
const searchBtn = document.getElementById('searchBtn');
const searchResult = document.getElementById('searchResult');
const resultContent = document.getElementById('resultContent');
const searchLoading = document.getElementById('searchLoading');
const toast = document.getElementById('toast');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const closeResultBtn = document.getElementById('closeResultBtn');

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadFiles();
    loadStores();
});

// ============================================================================
// Event Listeners Setup
// ============================================================================
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', handleTabChange);
    });

    // File upload
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    fileInput.addEventListener('change', handleFileSelect);

    // File list
    refreshFilesBtn.addEventListener('click', loadFiles);

    // Search
    searchBtn.addEventListener('click', performSearch);
    selectAllBtn.addEventListener('click', toggleSelectAll);
    closeResultBtn.addEventListener('click', () => {
        searchResult.style.display = 'none';
    });

    // Search with Ctrl+Enter
    searchQuery.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            performSearch();
        }
    });

    // Import panel buttons
    const confirmImportBtn = document.getElementById('confirmImportBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');

    if (confirmImportBtn) {
        confirmImportBtn.addEventListener('click', confirmImportFile);
    }
    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', cancelImportPanel);
    }

    // FileStore selection update
    const storeSelectForUpload = document.getElementById('storeSelectForUpload');
    if (storeSelectForUpload) {
        storeSelectForUpload.addEventListener('change', () => {
            // Simple handler for store selection
        });
    }
}

// ============================================================================
// Tab Management
// ============================================================================
function handleTabChange(e) {
    const tabName = e.currentTarget.getAttribute('data-tab');

    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    e.currentTarget.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    state.currentTab = tabName;

    // Tab-specific initialization
    if (tabName === 'files') {
        loadFiles();
    } else if (tabName === 'stores') {
        loadStores();
    } else if (tabName === 'search') {
        loadStores();
    }
}

// ============================================================================
// File Upload (Drag and Drop)
// ============================================================================
function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    handleFiles(files);
}

function handleFileSelect(e) {
    const files = e.target.files;
    handleFiles(files);
}

function handleFiles(files) {
    const fileArray = Array.from(files);
    uploadProgress.style.display = 'block';
    uploadStatus.innerHTML = '';

    fileArray.forEach((file, index) => {
        uploadFile(file, index, fileArray.length);
    });
}

// ============================================================================
// File Upload and Auto Import
// ============================================================================
async function uploadFile(file, index, total) {
    const formData = new FormData();
    formData.append('file', file);

    const fileName = file.name;
    const statusItem = document.createElement('div');
    statusItem.className = 'status-item';
    statusItem.id = `status-${index}`;
    statusItem.innerHTML = `
        <div class="status-icon">⏳</div>
        <div class="status-content">
            <div class="status-title">${fileName}</div>
            <div class="status-message">Uploading...</div>
        </div>
    `;
    uploadStatus.appendChild(statusItem);

    try {
        // 1. Upload file
        const uploadResponse = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData
        });

        const uploadData = await uploadResponse.json();

        if (!uploadData.success) {
            throw new Error(uploadData.error || 'Upload failed');
        }

        const fileId = uploadData.file_id;

        // Show upload success
        statusItem.querySelector('.status-message').textContent = 'Upload completed, importing to store...';

        // 2. Auto import to default store if available
        const stores = state.storesAllLoaded ? state.storesAll : state.stores;
        if (stores.length > 0) {
            const defaultStore = stores[0];

            const importResponse = await fetch(`/api/files/${fileId}/import`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    store_id: defaultStore.store_name
                })
            });

            const importData = await importResponse.json();

            if (!importData.success) {
                throw new Error(importData.error || 'Import failed');
            }

            statusItem.classList.add('success');
            statusItem.innerHTML = `
                <div class="status-icon">✓</div>
                <div class="status-content">
                    <div class="status-title">${fileName}</div>
                    <div class="status-message">Upload and import completed (${defaultStore.display_name})</div>
                </div>
            `;
            showToast(`${fileName} uploaded and imported successfully`, 'success');
        } else {
            // If no store, just upload
            statusItem.classList.add('success');
            statusItem.innerHTML = `
                <div class="status-icon">✓</div>
                <div class="status-content">
                    <div class="status-title">${fileName}</div>
                    <div class="status-message">Upload completed (no store)</div>
                </div>
            `;
            showToast(`${fileName} uploaded successfully (create a FileStore first)`, 'warning');
        }

        // Refresh file list when all uploads complete
        if (document.querySelectorAll('.status-item.success').length === total) {
            setTimeout(() => {
                loadFiles();
                loadStores();
                uploadProgress.style.display = 'none';
            }, 1000);
        }
    } catch (error) {
        statusItem.classList.add('error');
        statusItem.innerHTML = `
            <div class="status-icon">✗</div>
            <div class="status-content">
                <div class="status-title">${fileName}</div>
                <div class="status-message">${error.message}</div>
            </div>
        `;
        showToast(`${fileName} upload failed: ${error.message}`, 'error');
    }
}

// ============================================================================
// File Management
// ============================================================================
async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        const data = await response.json();

        if (data.success) {
            state.files = data.files;
            renderFiles();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('Error loading files:', error);
        filesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <p>Failed to load files: ${error.message}</p>
            </div>
        `;
    }
}

function renderFiles() {
    if (state.files.length === 0) {
        filesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>No uploaded files yet</p>
            </div>
        `;
        return;
    }

    filesList.innerHTML = state.files.map(file => {
        const sizeInMB = (file.size_bytes / (1024 * 1024)).toFixed(2);
        const fileName = file.display_name;
        const date = new Date(file.create_time).toLocaleDateString('en-US');
        const fileId = file.file_id;

        return `
            <div class="file-card">
                <div class="file-card-header">
                    <div class="file-icon">${getFileIcon(fileName)}</div>
                    <div class="file-card-actions">
                        <button title="Preview" onclick="previewFile('${fileId}', '${fileName}')">👁️</button>
                        <button title="Move to FileStore" onclick="showImportPanel('${fileId}', '${fileName}')">📤</button>
                        <button title="Delete" onclick="deleteFile('${fileId}', '${fileName}')">🗑️</button>
                    </div>
                </div>
                <div class="file-name" title="${fileName}">${fileName}</div>
                <div class="file-info">
                    <span>${sizeInMB} MB</span>
                    <span class="file-date">${date}</span>
                </div>
            </div>
        `;
    }).join('');
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': '📄',
        'txt': '📝',
        'doc': '📘',
        'docx': '📘',
        'xls': '📊',
        'xlsx': '📊',
        'ppt': '🎨',
        'pptx': '🎨',
        'csv': '📋',
        'json': '{}',
        'xml': '<>',
        'html': '🌐'
    };
    return iconMap[ext] || '📎';
}

async function deleteFile(fileId, fileName, options = {}) {
    const { refreshFiles = true, refreshStores = true } = options;

    if (!confirm(`Delete "${fileName}"?`)) {
        return false;
    }

    try {
        const response = await fetch(`/api/files/${fileId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showToast(`${fileName} deleted successfully`, 'success');
            if (refreshFiles) {
                loadFiles();
            }
            if (refreshStores) {
                loadStores();
            }
            return true;
        }

        throw new Error(data.error);
    } catch (error) {
        showToast(`Delete failed: ${error.message}`, 'error');
        return false;
    }
}

// File preview
async function previewFile(fileId, fileName) {
    try {
        const cleanFileId = fileId.replace(/^files\//, '');
        const response = await fetch(`/api/files/${cleanFileId}/preview`);
        const data = await response.json();

        if (!data.success) {
            showToast(`Preview unavailable: ${data.error}`, 'error');
            return;
        }

        if (data.mime_type?.startsWith('application/pdf')) {
            window.open(data.uri, '_blank');
        } else if (data.mime_type?.startsWith('text/')) {
            alert(`File: ${fileName}\nSize: ${(data.size_bytes / 1024 / 1024).toFixed(2)} MB\n\nFile info: ${data.uri}`);
        } else {
            window.open(data.uri, '_blank');
        }

        showToast(`Opening ${fileName} preview`, 'success');
    } catch (error) {
        showToast(`Preview error: ${error.message}`, 'error');
    }
}

// ============================================================================
// FileSearchStore Management
// ============================================================================
async function loadStores(options = {}) {
    const { page = 1, refreshAll = true } = options;
    const targetPage = refreshAll ? 1 : page;

    try {
        if (refreshAll || !state.storesAllLoaded) {
            state.storePageTokens = { 1: null };
            state.storeHasNext = false;
            await loadStoresAll();
        }

        await loadStoresPage(targetPage);
    } catch (error) {
        console.error('Error loading stores:', error);
        const storesContainer = document.getElementById('storesList');
        if (storesContainer) {
            storesContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❌</div>
                    <p>Failed to load stores: ${error.message}</p>
                </div>
            `;
        }
    }
}

async function loadStoresAll() {
    const params = new URLSearchParams({ all: 'true' });
    const response = await fetch(`/api/stores?${params}`);
    const data = await response.json();

    if (!data.success) {
        throw new Error(data.error);
    }

    state.storesAll = data.stores || [];
    state.storesAllLoaded = true;
    state.storeTotalPages = Math.max(1, Math.ceil(state.storesAll.length / state.storePageSize));
    if (state.storePage > state.storeTotalPages) {
        state.storePage = state.storeTotalPages;
    }

    renderStoresForSearch();
    updateStoreSelects();
    updateStats();
}

async function loadStoresPage(page = 1) {
    const params = new URLSearchParams();
    const pageToken = page === 1 ? null : state.storePageTokens[page];

    if (page > 1 && !pageToken) {
        showToast('No more pages available', 'info');
        return;
    }

    if (pageToken) {
        params.set('page_token', pageToken);
    }

    const response = await fetch(`/api/stores?${params}`);
    const data = await response.json();

    if (!data.success) {
        throw new Error(data.error);
    }

    state.stores = data.stores || [];
    state.storePage = page;
    state.storeHasNext = Boolean(data.next_page_token);
    if (data.next_page_token) {
        state.storePageTokens[page + 1] = data.next_page_token;
    }

    renderStores();
}

function updateStoreSelects() {
    const storeSelectForUpload = document.getElementById('storeSelectForUpload');
    if (storeSelectForUpload) {
        const selectedValue = storeSelectForUpload.value;
        storeSelectForUpload.innerHTML = '<option value="">Select FileStore...</option>';

        const stores = state.storesAllLoaded ? state.storesAll : state.stores;
        stores.forEach(store => {
            const option = document.createElement('option');
            option.value = store.store_name;
            option.textContent = store.display_name;
            storeSelectForUpload.appendChild(option);
        });

        if (selectedValue) {
            storeSelectForUpload.value = selectedValue;
        }
    }
}

function renderStores() {
    const storesContainer = document.getElementById('storesList');
    if (!storesContainer) return;

    const storesToRender = state.showAllStores ? state.storesAll : state.stores;
    const totalStores = state.storesAllLoaded ? state.storesAll.length : storesToRender.length;
    const toggleLabel = state.showAllStores ? 'Show pages' : 'Show all';

    if (totalStores === 0) {
        storesContainer.innerHTML = `
            <div class="create-store-form">
                <div class="create-store-header">
                    <h3>Create New FileSearchStore</h3>
                    <button class="btn btn-secondary btn-sm store-toggle" onclick="toggleStoreView()">${toggleLabel}</button>
                </div>
                <input type="text" id="newStoreName" placeholder="Store name (e.g., Document Store)" class="input-field">
                <button class="btn btn-primary" onclick="createStore()">Create</button>
            </div>
            <div class="empty-state">
                <div class="empty-icon">💾</div>
                <p>No FileSearchStores created yet</p>
            </div>
        `;
        return;
    }

    if (storesToRender.length === 0) {
        storesContainer.innerHTML = `
            <div class="create-store-form">
                <div class="create-store-header">
                    <h3>Create New FileSearchStore</h3>
                    <button class="btn btn-secondary btn-sm store-toggle" onclick="toggleStoreView()">${toggleLabel}</button>
                </div>
                <input type="text" id="newStoreName" placeholder="Store name (e.g., Document Store)" class="input-field">
                <button class="btn btn-primary" onclick="createStore()">Create</button>
            </div>
            <div class="empty-state">
                <div class="empty-icon">📄</div>
                <p>No FileSearchStores on this page</p>
            </div>
        `;
        return;
    }

    const storeCards = storesToRender.map(store => {
        const activeCount = store.active_documents_count || 0;
        const pendingCount = store.pending_documents_count || 0;
        const failedCount = store.failed_documents_count || 0;
        const totalSize = store.size_bytes || 0;
        const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
        const createdDate = new Date(store.create_time).toLocaleDateString('en-US');

        return `
            <div class="store-card" onclick="showStoreDocuments('${store.store_name}', '${store.display_name}')" title="View documents">
                <div class="store-header">
                    <h3>${store.display_name}</h3>
                    <div class="store-actions">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); showStoreDocuments('${store.store_name}', '${store.display_name}')">View documents</button>
                        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteStore('${store.store_name}', '${store.display_name}')">Delete</button>
                    </div>
                </div>
                <div class="store-hint">Click "View documents" to see files in this store.</div>
                <div class="store-info">
                    <div class="store-stat">
                        <span class="store-label">Active Documents:</span>
                        <span class="store-value file-count-${store.store_name.replace(/\//g, '-')}">${activeCount}</span>
                    </div>
                    <div class="store-stat">
                        <span class="store-label">Processing:</span>
                        <span class="store-value">${pendingCount}</span>
                    </div>
                    ${failedCount > 0 ? `
                    <div class="store-stat">
                        <span class="store-label">Failed:</span>
                        <span class="store-value error">${failedCount}</span>
                    </div>
                    ` : ''}
                    <div class="store-stat">
                        <span class="store-label">Storage:</span>
                        <span class="store-value">${sizeInMB} MB</span>
                    </div>
                    <div class="store-stat">
                        <span class="store-label">Created:</span>
                        <span class="store-value">${createdDate}</span>
                    </div>
                    <div class="store-stat">
                        <span class="store-label">Store ID:</span>
                        <span class="store-value store-id" style="font-size: 12px;">${store.store_name}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const totalPages = state.storesAllLoaded
        ? state.storeTotalPages
        : Math.max(1, Math.ceil(totalStores / state.storePageSize));
    const paginationHtml = (!state.showAllStores && totalPages > 1)
        ? `
            <div class="stores-pagination">
                <div class="pagination-info">Page ${state.storePage} of ${totalPages}</div>
                <div class="pagination-controls">
                    <button class="btn btn-secondary btn-sm" onclick="prevStorePage()" ${state.storePage <= 1 ? 'disabled' : ''}>Previous</button>
                    <button class="btn btn-secondary btn-sm" onclick="nextStorePage()" ${state.storePage >= totalPages ? 'disabled' : ''}>Next</button>
                </div>
            </div>
        `
        : '';

    storesContainer.innerHTML = `
        <div class="create-store-form">
            <div class="create-store-header">
                <h3>Create New FileSearchStore</h3>
                <button class="btn btn-secondary btn-sm store-toggle" onclick="toggleStoreView()">${toggleLabel}</button>
            </div>
            <input type="text" id="newStoreName" placeholder="Store name (e.g., Document Store)" class="input-field">
            <button class="btn btn-primary" onclick="createStore()">Create</button>
        </div>
        <div class="stores-grid">
            ${storeCards}
        </div>
        ${paginationHtml}
    `;

    updateStats();
}

function updateStats() {
    const totalFilesElem = document.getElementById('totalFiles');
    const totalSizeElem = document.getElementById('totalSize');

    if (totalFilesElem && totalSizeElem) {
        const stores = state.storesAllLoaded ? state.storesAll : state.stores;
        const totalActiveDocuments = stores.reduce((sum, s) => sum + (s.active_documents_count || 0), 0);
        totalFilesElem.textContent = totalActiveDocuments;

        const totalBytes = stores.reduce((sum, s) => sum + (s.size_bytes || 0), 0);
        const totalSize = (totalBytes / (1024 * 1024)).toFixed(2);
        totalSizeElem.textContent = totalSize + ' MB';
    }
}

async function toggleStoreView() {
    state.showAllStores = !state.showAllStores;
    if (state.showAllStores && !state.storesAllLoaded) {
        await loadStores({ page: 1, refreshAll: true });
        return;
    }
    renderStores();
}

function nextStorePage() {
    if (state.showAllStores) return;
    if (state.storePage < state.storeTotalPages) {
        loadStores({ page: state.storePage + 1, refreshAll: false });
    }
}

function prevStorePage() {
    if (state.showAllStores) return;
    if (state.storePage > 1) {
        loadStores({ page: state.storePage - 1, refreshAll: false });
    }
}

async function createStore() {
    const nameInput = document.getElementById('newStoreName');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('Please enter a store name', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/stores/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`FileStore "${name}" created successfully`, 'success');
            nameInput.value = '';
            loadStores();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast(`Failed to create store: ${error.message}`, 'error');
    }
}

async function deleteStore(storeId, storeName) {
    if (!confirm(`Delete FileStore "${storeName}"?\nThis removes the store only; files remain in the Files list.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/stores/${storeId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showToast(`FileStore "${storeName}" deleted successfully`, 'success');
            loadStores();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast(`Failed to delete store: ${error.message}`, 'error');
    }
}

// ============================================================================
// Search Functionality
// ============================================================================
function renderStoresForSearch() {
    const container = fileCheckboxList;
    if (!container) return;

    const stores = state.storesAllLoaded ? state.storesAll : state.stores;
    if (stores.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No FileSearchStores available</p>
                <small>Create a store in the FileStore tab</small>
            </div>
        `;
        return;
    }

    const storeRadios = stores.map((store, index) => {
        const fileCount = store.active_documents_count || 0;
        const checked = index === 0 ? 'checked' : '';

        return `
            <label class="checkbox-item">
                <input type="radio" name="store" value="${store.store_name}" class="store-radio" ${checked}>
                <span class="checkbox-label">${store.display_name}</span>
                <span class="checkbox-size">${fileCount} documents</span>
            </label>
        `;
    }).join('');

    container.innerHTML = storeRadios;

    if (stores.length > 0) {
        state.selectedStoreId = stores[0].store_name;
    }

    document.querySelectorAll('.store-radio').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.selectedStoreId = e.target.value;
        });
    });
}

function toggleSelectAll() {
    showToast('Only one store can be selected', 'info');
}

async function performSearch() {
    const selectedRadio = document.querySelector('.store-radio:checked');

    if (!selectedRadio) {
        showToast('Please select a FileStore to search', 'warning');
        return;
    }

    const query = searchQuery.value.trim();
    if (!query) {
        showToast('Please enter a search question', 'warning');
        return;
    }

    const storeId = selectedRadio.value;
    let metadataFilter = null;
    if (metadataFilterInput && metadataFilterInput.value.trim()) {
        metadataFilter = metadataFilterInput.value.trim();
    }

    searchLoading.style.display = 'flex';
    searchResult.style.display = 'none';

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: query,
                store_ids: [storeId],
                metadata_filter: metadataFilter
            })
        });

        const data = await response.json();

        if (data.success) {
            renderSearchResult(data.result, data.citations);
            searchResult.style.display = 'block';
            showToast('Search completed', 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast(`Search failed: ${error.message}`, 'error');
    } finally {
        searchLoading.style.display = 'none';
    }
}

function renderSearchResult(result, citations) {
    let html = `<div class="result-text">${result}</div>`;

    if (citations && citations.length > 0) {
        html += `
            <div class="citations-section">
                <h4>Citations</h4>
                <div class="citations-list">
        `;

        citations.forEach((citation, index) => {
            html += `
                <div class="citation-item">
                    <div class="citation-number">[${index + 1}]</div>
                    <div class="citation-content">
                        <div class="citation-text">${citation.content || citation.text || 'No content'}</div>
                        ${citation.source ? `<div class="citation-source">Source: ${citation.source}</div>` : ''}
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    resultContent.innerHTML = html;
}

// ============================================================================
// Direct FileStore Upload
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const uploadToStoreArea = document.getElementById('uploadToStoreArea');
    const fileInputForStore = document.getElementById('fileInputForStore');

    if (uploadToStoreArea) {
        uploadToStoreArea.addEventListener('click', () => fileInputForStore.click());
        uploadToStoreArea.addEventListener('dragover', handleDragOver);
        uploadToStoreArea.addEventListener('dragleave', handleDragLeave);
        uploadToStoreArea.addEventListener('drop', (e) => handleDropForStore(e));
        fileInputForStore.addEventListener('change', handleFileSelectForStore);
    }
});

function handleDropForStore(e) {
    handleDragLeave(e);
    const files = e.dataTransfer.files;

    if (files.length > 0) {
        const store = document.getElementById('storeSelectForUpload').value;
        if (!store) {
            showToast('Please select a FileStore first', 'error');
            return;
        }

        Array.from(files).forEach(file => {
            uploadToFileSearchStore(file, store);
        });
    }
}

function handleFileSelectForStore(e) {
    const store = document.getElementById('storeSelectForUpload').value;
    if (!store) {
        showToast('Please select a FileStore first', 'error');
        return;
    }

    Array.from(e.target.files).forEach(file => {
        uploadToFileSearchStore(file, store);
    });
}

async function uploadToFileSearchStore(file, storeName) {
    const validExtensions = ['pdf', 'txt', 'doc', 'docx', 'xlsx', 'xls', 'ppt', 'pptx', 'csv', 'json', 'xml', 'html'];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!validExtensions.includes(ext)) {
        showToast(`Unsupported file format: ${file.name}`, 'error');
        return;
    }

    const uploadProgress = document.getElementById('uploadToStoreProgress');
    const uploadStatus = document.getElementById('uploadToStoreStatus');
    const progressFill = document.getElementById('progressFillStore');
    const uploadFileName = document.getElementById('uploadToStoreFileName');

    uploadFileName.textContent = `Uploading ${file.name}...`;
    uploadProgress.style.display = 'block';
    uploadStatus.innerHTML = '';

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('store_name', storeName);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressFill.style.width = percentComplete + '%';
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 201) {
                const response = JSON.parse(xhr.responseText);
                showToast(`${file.name} uploaded to FileStore successfully`, 'success');
                uploadStatus.innerHTML = `<div class="success-message">✅ ${file.name} upload completed</div>`;

                setTimeout(() => {
                    loadStores();
                    uploadProgress.style.display = 'none';
                    uploadStatus.innerHTML = '';
                }, 2000);
            } else {
                const error = JSON.parse(xhr.responseText);
                showToast(`Upload failed: ${error.error || 'Unknown error'}`, 'error');
                uploadStatus.innerHTML = `<div class="error-message">❌ Upload failed: ${error.error}</div>`;
            }
        });

        xhr.addEventListener('error', () => {
            showToast('An error occurred during upload', 'error');
            uploadStatus.innerHTML = '<div class="error-message">❌ Upload error</div>';
        });

        xhr.open('POST', '/api/stores/upload');
        xhr.send(formData);

    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
        uploadStatus.innerHTML = `<div class="error-message">❌ Error: ${error.message}</div>`;
    }
}

// ============================================================================
// Move Files to FileStore
// ============================================================================
let selectedFileForImport = null;

function showImportPanel(fileId, fileName) {
    selectedFileForImport = {
        file_id: fileId,
        display_name: fileName
    };

    const importPanel = document.getElementById('importPanel');
    importPanel.style.display = 'block';

    const storeSelect = document.getElementById('storeSelectForImport');
    storeSelect.innerHTML = '<option value="">Select FileStore...</option>';

    const stores = state.storesAllLoaded ? state.storesAll : state.stores;
    stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.store_name;
        option.textContent = store.display_name;
        storeSelect.appendChild(option);
    });
}

function cancelImportPanel() {
    document.getElementById('importPanel').style.display = 'none';
    selectedFileForImport = null;
}

async function confirmImportFile() {
    if (!selectedFileForImport) {
        showToast('No file selected', 'error');
        return;
    }

    const storeName = document.getElementById('storeSelectForImport').value;
    if (!storeName) {
        showToast('Please select a FileStore', 'error');
        return;
    }

    const importStatus = document.getElementById('importStatus');
    importStatus.innerHTML = '<div class="loading" style="display: flex; align-items: center; gap: 10px;"><div class="spinner"></div><span>Moving file...</span></div>';

    try {
        const response = await fetch(`/api/files/${encodeURIComponent(selectedFileForImport.file_id)}/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                store_id: storeName
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`${selectedFileForImport.display_name} moved to FileStore successfully`, 'success');
            importStatus.innerHTML = `<div class="success-message">✅ Move completed</div>`;

            setTimeout(() => {
                document.getElementById('importPanel').style.display = 'none';
                loadStores();
                selectedFileForImport = null;
            }, 2000);
        } else {
            showToast(`Move failed: ${data.error || 'Unknown error'}`, 'error');
            importStatus.innerHTML = `<div class="error-message">❌ Failed: ${data.error}</div>`;
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
        importStatus.innerHTML = `<div class="error-message">❌ Error: ${error.message}</div>`;
    }
}

// ============================================================================
// View FileStore Documents
// ============================================================================
async function deleteStoreDocument(storeName, displayName, fileId, fileName) {
    const deleted = await deleteFile(fileId, fileName, { refreshStores: false });
    if (deleted) {
        showStoreDocuments(storeName, displayName, { page: state.storeDocumentPage, reset: false });
    }
}

async function removeStoreDocument(storeName, displayName, documentName, fileName) {
    if (!documentName) {
        showToast('Document id not available', 'error');
        return;
    }

    if (!confirm(`Remove "${fileName}" from this FileStore?`)) {
        return;
    }

    try {
        const response = await fetch(
            `/api/stores/${encodeURIComponent(storeName)}/documents/${encodeURIComponent(documentName)}`,
            { method: 'DELETE' }
        );

        const data = await response.json();

        if (data.success) {
            showToast(`${fileName} removed from store`, 'success');
            showStoreDocuments(storeName, displayName, { page: state.storeDocumentPage, reset: false });
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast(`Remove failed: ${error.message}`, 'error');
    }
}

async function showStoreDocuments(storeName, displayName, options = {}) {
    const { page, reset = true } = options;
    const storesContainer = document.getElementById('storesList');
    const sameStore = state.storeDocumentStoreName === storeName;

    if (!sameStore || reset) {
        state.storeDocumentPageTokens = { 1: null };
        state.storeDocumentHasNext = false;
        state.storeDocumentPage = 1;
    }

    state.storeDocumentStoreName = storeName;
    state.storeDocumentDisplayName = displayName;

    const targetPage = page || state.storeDocumentPage || 1;
    const pageToken = targetPage === 1 ? null : state.storeDocumentPageTokens[targetPage];

    if (targetPage > 1 && !pageToken) {
        showToast('No more pages available', 'info');
        return;
    }

    try {
        const params = new URLSearchParams();
        params.set('page_size', state.storeDocumentPageSize);
        if (pageToken) {
            params.set('page_token', pageToken);
        }

        const response = await fetch(
            `/api/stores/${encodeURIComponent(storeName)}/documents?${params}`
        );
        const data = await response.json();

        if (data.success) {
            const documents = data.documents || [];
            const documentCount = data.count || 0;

            state.storeDocumentPage = targetPage;
            state.storeDocumentHasNext = Boolean(data.next_page_token);
            if (data.next_page_token) {
                state.storeDocumentPageTokens[targetPage + 1] = data.next_page_token;
            }

            const fileCountElement = document.querySelector(`.file-count-${storeName.replace(/\//g, '-')}`);
            if (fileCountElement && !data.next_page_token && targetPage === 1) {
                fileCountElement.textContent = `${documentCount}`;
            }

            const safeStoreName = storeName.replace(/'/g, "\\'");
            const safeDisplayName = displayName.replace(/'/g, "\\'");
            const countLabel = documentCount === 1 ? '1 document' : `${documentCount} documents`;
            const showPagination = state.storeDocumentPage > 1 || state.storeDocumentHasNext;
            const paginationHtml = showPagination
                ? `
                    <div class="docs-pagination">
                        <div class="pagination-info">Page ${state.storeDocumentPage}</div>
                        <div class="pagination-controls">
                            <button class="btn btn-secondary btn-sm" onclick="prevStoreDocumentPage()" ${state.storeDocumentPage <= 1 ? 'disabled' : ''}>Previous</button>
                            <button class="btn btn-secondary btn-sm" onclick="nextStoreDocumentPage()" ${!state.storeDocumentHasNext ? 'disabled' : ''}>Next</button>
                        </div>
                    </div>
                `
                : '';
            const documentListHtml = documents.length > 0
                ? `
                    <div class="store-documents">
                        <h4>Stored Documents (Page ${state.storeDocumentPage})</h4>
                        <p class="store-detail-hint">Showing ${countLabel}. Remove from store keeps the file. Delete file removes it everywhere.</p>
                        <ul class="document-list">
                            ${documents.map(doc => {
                                const docName = doc.display_name || doc.document_name || 'Untitled';
                                const safeDocName = docName.replace(/'/g, "\\'");
                                const docType = doc.mime_type || 'Unknown';
                                const fileId = doc.file_id;
                                const safeFileId = fileId ? fileId.replace(/'/g, "\\'") : '';
                                const documentName = doc.document_name || '';
                                const safeDocumentName = documentName ? documentName.replace(/'/g, "\\'") : '';
                                const removeButton = documentName
                                    ? `<button class="btn btn-secondary btn-sm" onclick="removeStoreDocument('${safeStoreName}', '${safeDisplayName}', '${safeDocumentName}', '${safeDocName}')">Remove from store</button>`
                                    : '';
                                const deleteButton = fileId
                                    ? `<button class="btn btn-danger btn-sm" onclick="deleteStoreDocument('${safeStoreName}', '${safeDisplayName}', '${safeFileId}', '${safeDocName}')">Delete file</button>`
                                    : '';
                                const note = fileId
                                    ? 'Delete file removes it from Files and all stores.'
                                    : 'Remove from store keeps the file in My Files.';
                                return `
                                    <li class="document-item">
                                        <div class="doc-header">
                                            <span class="doc-name">${docName}</span>
                                            ${(removeButton || deleteButton) ? `<div class="doc-actions">${removeButton}${deleteButton}</div>` : ''}
                                        </div>
                                        <span class="doc-type">${docType}</span>
                                        <span class="doc-note">${note}</span>
                                    </li>
                                `;
                            }).join('')}
                        </ul>
                        ${paginationHtml}
                    </div>
                `
                : '<p class="empty-message">No stored documents</p>';

            storesContainer.innerHTML = `
                <div class="store-detail-view">
                    <button class="btn btn-secondary" onclick="loadStores()">← Back</button>
                    <h3>${displayName}</h3>
                    ${documentListHtml}
                </div>
            `;

            showToast(`Loaded documents for ${displayName}`, 'success');
        } else {
            showToast(`Failed to load documents: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

function nextStoreDocumentPage() {
    if (!state.storeDocumentStoreName || !state.storeDocumentHasNext) {
        return;
    }
    showStoreDocuments(state.storeDocumentStoreName, state.storeDocumentDisplayName, {
        page: state.storeDocumentPage + 1,
        reset: false
    });
}

function prevStoreDocumentPage() {
    if (!state.storeDocumentStoreName || state.storeDocumentPage <= 1) {
        return;
    }
    showStoreDocuments(state.storeDocumentStoreName, state.storeDocumentDisplayName, {
        page: state.storeDocumentPage - 1,
        reset: false
    });
}

// ============================================================================
// Utilities
// ============================================================================
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
