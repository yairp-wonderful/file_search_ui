# Gemini File Search UI

A local, self-hosted web app for managing Gemini File Search stores: upload files, move them into stores, and run semantic search with citations.

## Highlights

- Manage FileSearchStores (create, list, paginate, delete)
- View store documents and remove documents from a store
- Upload files to the Files API and move them into stores
- Directly upload files into a store
- Run semantic search across one or more stores
- Add metadata filters to narrow search scope
- Server-side logging with rotating log files

## How it works

- The frontend (HTML/CSS/JS) calls a Flask API served from the same app.
- The backend uses the `google-genai` SDK with a REST fallback for File Search operations.
- Files uploaded from the UI are saved to a temporary file, sent to Gemini, and then removed locally.
- Store documents and files live in Gemini; this app does not use a local database.

## Supported file types

`pdf`, `txt`, `md`, `markdown`, `doc`, `docx`, `xlsx`, `xls`, `ppt`, `pptx`, `csv`, `json`, `xml`, `html`

Max upload size is 100MB per file (see `app/__init__.py`).

## Prerequisites

- Python 3.8+
- A Gemini API key (or bearer token)

## Setup

1. Clone the repo
   ```bash
   git clone https://github.com/yairp-wonderful/file_search_ui.git
   cd file_search_ui
   ```

2. Create and activate a virtual environment
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies
   ```bash
   pip install -r requirements.txt
   ```

4. Create a `.env` file in the project root
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your `GEMINI_API_KEY`.

5. Run the app
   ```bash
   python main.py
   ```

The UI will be available at `http://localhost:5001`.

## Configuration

- `GEMINI_API_KEY` (required): Gemini API key or a bearer token. For bearer tokens, use the format `Bearer <token>`.
- `FLASK_DEBUG` (optional): `True` or `False` to enable Flask debug mode.

## Usage

### File Upload tab

- Upload a file to the Gemini Files API.
- Use the action buttons to preview, move to a store, or delete.

### My Files tab

- Shows files currently in the Files API (temporary storage).
- Move a file into a FileSearchStore or delete it.

### File Stores tab

- Create stores and view your existing stores.
- Open a store to list its documents.
- Use "Remove from store" to delete the store document.
- Use "Delete file" to delete the underlying file (only available when a file id is present).
- Delete a store after it is empty.

### Chat Search tab

- Select one or more stores and enter a natural language query.
- Optional metadata filter accepts a string expression to scope your search (examples: `category = "payroll"`, `tags = "hr"`, `year = 2024`).
- Results include citations back to the source documents.

## Pagination and metrics

The Gemini API returns stores in pages (typically 10 at a time). The UI supports two modes:

- Paged view: browse one page at a time using the pagination controls.
- Show all: fetches every page to compute totals like storage and document counts.

Totals are based on the stores currently loaded in the UI.

Documents inside a store are also paginated. Use the next/previous controls in the store detail view to page through documents.

## API endpoints

- `GET /api/stores` - List stores (supports `page_token` and `all=true`)
- `POST /api/stores/create` - Create a store
- `GET /api/stores/<store_id>` - Get store details
- `DELETE /api/stores/<store_id>` - Delete a store
- `GET /api/stores/<store_id>/documents` - List store documents (supports `page_token` and `page_size`)
- `DELETE /api/stores/<store_id>/documents/<document_id>` - Remove a document from a store
- `GET /api/files` - List Files API uploads
- `POST /api/files/upload` - Upload a file to the Files API
- `GET /api/files/<file_id>` - Get file metadata
- `GET /api/files/<file_id>/preview` - Get file preview info
- `DELETE /api/files/<file_id>` - Delete a file
- `POST /api/files/<file_id>/import` - Import a file into a store
- `POST /api/stores/upload` - Upload directly to a store
- `POST /api/search` - Run a file search query (accepts `metadata_filter` as a string, returns `citations`)

## Logging

Logs are written to `logs/app.log` with rotation (10MB files, up to 5 backups). Console logs include INFO and above.

## Troubleshooting

- Store deletion fails: remove all documents from the store first.
- "Delete file" unavailable: the document does not include a file id from the API.
- UI shows "Failed to fetch": ensure the Flask server is running on port 5001.

## License

This project is licensed under the MIT License.

## References

- https://ai.google.dev/gemini-api/docs/file-search
