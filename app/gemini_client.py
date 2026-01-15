"""
Gemini Client using the new google.genai SDK
Implements FileSearchStore API for document search and retrieval
"""
import google.genai as genai
from typing import Optional, List, Dict, Any
import json
import mimetypes
import os
from pathlib import Path
import time

import requests

from app.logger import get_logger

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
UPLOAD_BASE_URL = "https://generativelanguage.googleapis.com/upload/v1beta"
DEFAULT_TIMEOUT = 30
UPLOAD_TIMEOUT = 120

mimetypes.add_type("text/plain", ".md")
mimetypes.add_type("text/plain", ".markdown")


def _as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _pick(data: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


class GeminiClient:
    """Client for interacting with Gemini API using google.genai SDK"""

    def __init__(self, api_key: str):
        """
        Initialize Gemini client with API key

        Args:
            api_key: Google AI API key for authentication
        """
        self.api_key = api_key
        self.logger = get_logger()

        # Configure the client with API key
        self.client = genai.Client(api_key=api_key)        
        self.logger.info("GeminiClient initialized successfully")

    def _supports_file_search_stores(self) -> bool:
        return hasattr(self.client, "file_search_stores")

    def _is_bearer_token(self) -> bool:
        return isinstance(self.api_key, str) and self.api_key.lower().startswith("bearer ")

    def _rest_params(self) -> Dict[str, str]:
        if self._is_bearer_token():
            return {}
        return {"key": self.api_key}

    def _rest_headers(self, json_body: bool = False) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self._is_bearer_token():
            headers["Authorization"] = self.api_key
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _rest_request(
        self,
        method: str,
        url: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, str]] = None,
        files: Optional[Dict[str, Any]] = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> requests.Response:
        request_params = self._rest_params()
        if params:
            request_params.update(params)

        headers = self._rest_headers(json_body=json_body is not None and files is None)
        return requests.request(
            method,
            url,
            params=request_params,
            headers=headers,
            json=json_body,
            files=files,
            timeout=timeout,
        )

    def _poll_operation(self, operation_name: str, timeout: int = 180, interval: int = 2) -> Dict[str, Any]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self._rest_request("GET", f"{BASE_URL}/{operation_name}")
            response.raise_for_status()
            operation = response.json()
            if operation.get("done"):
                if operation.get("error"):
                    error = operation["error"]
                    raise RuntimeError(error.get("message", str(error)))
                return operation
            time.sleep(interval)
        raise TimeoutError(f"Operation {operation_name} did not complete within {timeout}s")

    def _normalize_store(self, store: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "store_name": _pick(store, "name", "store_name", "storeName"),
            "display_name": _pick(store, "displayName", "display_name"),
            "create_time": str(_pick(store, "createTime", "create_time")) if _pick(store, "createTime", "create_time") else None,
            "update_time": str(_pick(store, "updateTime", "update_time")) if _pick(store, "updateTime", "update_time") else None,
            "active_documents_count": _as_int(_pick(store, "activeDocumentCount", "activeDocumentsCount", "active_documents_count")),
            "pending_documents_count": _as_int(_pick(store, "pendingDocumentCount", "pendingDocumentsCount", "pending_documents_count")),
            "failed_documents_count": _as_int(_pick(store, "failedDocumentCount", "failedDocumentsCount", "failed_documents_count")),
            "size_bytes": _as_int(_pick(store, "sizeBytes", "size_bytes")),
        }

    def _normalize_document(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        file_ref = _pick(doc, "file", "fileId", "file_id", "fileName", "file_name", "source")
        file_id = None
        if isinstance(file_ref, dict):
            file_id = _pick(file_ref, "name", "fileId", "file_id", "id", "file")
        elif isinstance(file_ref, str):
            file_id = file_ref

        return {
            "document_name": _pick(doc, "name", "document_name", "documentName"),
            "display_name": _pick(doc, "displayName", "display_name"),
            "mime_type": _pick(doc, "mimeType", "mime_type"),
            "create_time": str(_pick(doc, "createTime", "create_time")) if _pick(doc, "createTime", "create_time") else None,
            "update_time": str(_pick(doc, "updateTime", "update_time")) if _pick(doc, "updateTime", "update_time") else None,
            "size_bytes": _as_int(_pick(doc, "sizeBytes", "size_bytes")),
            "file_id": file_id,
        }

    def _generate_content_with_file_search(
        self,
        query: str,
        store_names: List[str],
        model: str,
        metadata_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        file_search_config: Dict[str, Any] = {
            "file_search_store_names": store_names,
        }
        if metadata_filter is not None:
            file_search_config["metadata_filter"] = metadata_filter

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": query}],
                }
            ],
            "tools": [
                {
                    "file_search": file_search_config,
                }
            ],
        }

        response = self._rest_request(
            "POST",
            f"{BASE_URL}/models/{model}:generateContent",
            json_body=payload,
        )
        response.raise_for_status()
        return response.json()

    def _extract_text_from_generate_content(self, data: Dict[str, Any]) -> str:
        candidates = data.get("candidates") or []
        if not candidates:
            return ""
        candidate = candidates[0] or {}
        content = candidate.get("content") or {}
        parts = content.get("parts") or []
        texts = []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                texts.append(part["text"])
        return "".join(texts).strip()

    def _extract_citations(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        citations_out: List[Dict[str, Any]] = []
        seen: set = set()

        candidates = data.get("candidates") or []
        if not candidates:
            return citations_out

        candidate = candidates[0] or {}

        def add_citation(source: Optional[str], text: Optional[str]) -> None:
            if not source and not text:
                return
            key = (source or "", text or "")
            if key in seen:
                return
            seen.add(key)
            entry: Dict[str, Any] = {}
            if text is not None:
                entry["content"] = text
                entry["text"] = text
            if source is not None:
                entry["source"] = source
            citations_out.append(entry)

        citation_meta = candidate.get("citationMetadata") or candidate.get("citation_metadata") or {}
        citations = citation_meta.get("citations") or []
        for citation in citations:
            if not isinstance(citation, dict):
                continue
            source = _pick(citation, "uri", "url", "source", "sourceId", "document", "name")
            text = _pick(citation, "snippet", "text", "content", "title")
            add_citation(source, text)

        grounding = candidate.get("groundingMetadata") or candidate.get("grounding_metadata") or {}
        grounding_chunks = grounding.get("groundingChunks") or grounding.get("grounding_chunks") or []
        for chunk in grounding_chunks:
            if not isinstance(chunk, dict):
                continue
            context = chunk.get("retrievedContext") or chunk.get("retrieved_context") or {}
            if not isinstance(context, dict):
                continue
            source = _pick(context, "uri", "url", "source", "sourceId", "document", "name")
            text = _pick(context, "text", "snippet", "content", "title")
            add_citation(source, text)

        return citations_out

    # ==================== FileSearchStore Methods ====================

    def create_file_search_store(self, display_name: str) -> Dict[str, Any]:
        """
        Create a new FileSearchStore

        Args:
            display_name: Display name for the store

        Returns:
            Dict with success status and store information
        """
        try:
            self.logger.info(f"Creating FileSearchStore with display_name: {display_name}")

            if self._supports_file_search_stores():
                store = self.client.file_search_stores.create(
                    config={'display_name': display_name}
                )

                self.logger.info(f"FileSearchStore created successfully: {store.name}")
                return {
                    "success": True,
                    "store_name": store.name,
                    "display_name": store.display_name,
                    "create_time": str(store.create_time) if hasattr(store, 'create_time') else None,
                    "update_time": str(store.update_time) if hasattr(store, 'update_time') else None
                }

            response = self._rest_request(
                "POST",
                f"{BASE_URL}/fileSearchStores",
                json_body={"displayName": display_name},
            )
            response.raise_for_status()
            store = response.json()
            normalized = self._normalize_store(store)

            self.logger.info(f"FileSearchStore created successfully: {normalized.get('store_name')}")
            return {
                "success": True,
                "store_name": normalized.get("store_name"),
                "display_name": normalized.get("display_name"),
                "create_time": normalized.get("create_time"),
                "update_time": normalized.get("update_time"),
            }
        except Exception as e:
            self.logger.error(f"Error creating FileSearchStore: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def list_file_search_stores(
        self,
        page_token: Optional[str] = None,
        all_pages: bool = False,
    ) -> Dict[str, Any]:
        """
        List all FileSearchStores

        Returns:
            Dict with success status and list of stores
        """
        try:
            self.logger.info("Listing all FileSearchStores")

            store_list = []
            next_page_token = None

            if self._supports_file_search_stores() and not page_token and not all_pages:
                stores = self.client.file_search_stores.list()
                for store in stores:
                    store_info = {
                        "store_name": store.name,
                        "display_name": store.display_name,
                        "create_time": str(store.create_time) if hasattr(store, 'create_time') else None,
                        "update_time": str(store.update_time) if hasattr(store, 'update_time') else None,
                        "active_documents_count": int(store.active_documents_count) if (hasattr(store, 'active_documents_count') and store.active_documents_count is not None) else 0,
                        "pending_documents_count": int(store.pending_documents_count) if (hasattr(store, 'pending_documents_count') and store.pending_documents_count is not None) else 0,
                        "failed_documents_count": int(store.failed_documents_count) if (hasattr(store, 'failed_documents_count') and store.failed_documents_count is not None) else 0,
                        "size_bytes": int(store.size_bytes) if (hasattr(store, 'size_bytes') and store.size_bytes is not None) else 0
                    }
                    store_list.append(store_info)
            else:
                token = page_token
                while True:
                    params: Dict[str, str] = {}
                    if token:
                        params["pageToken"] = token

                    response = self._rest_request("GET", f"{BASE_URL}/fileSearchStores", params=params)
                    response.raise_for_status()
                    data = response.json()
                    stores = data.get("fileSearchStores") or data.get("stores") or []
                    for store in stores:
                        if isinstance(store, dict):
                            store_list.append(self._normalize_store(store))

                    token = data.get("nextPageToken")
                    next_page_token = token
                    if not all_pages or not token:
                        break

            self.logger.info(f"Found {len(store_list)} FileSearchStores")
            return {
                "success": True,
                "stores": store_list,
                "count": len(store_list),
                "next_page_token": next_page_token
            }
        except Exception as e:
            self.logger.error(f"Error listing FileSearchStores: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "stores": []
            }

    def get_file_search_store(self, store_name: str) -> Dict[str, Any]:
        """
        Get a specific FileSearchStore by name

        Args:
            store_name: Name of the store to retrieve

        Returns:
            Dict with success status and store information
        """
        try:
            self.logger.info(f"Getting FileSearchStore: {store_name}")

            if self._supports_file_search_stores():
                store = self.client.file_search_stores.get(name=store_name)

                self.logger.info(f"FileSearchStore retrieved successfully: {store_name}")
                return {
                    "success": True,
                    "store_name": store.name,
                    "display_name": store.display_name,
                    "create_time": str(store.create_time) if hasattr(store, 'create_time') else None,
                    "update_time": str(store.update_time) if hasattr(store, 'update_time') else None,
                    "active_documents_count": int(store.active_documents_count) if (hasattr(store, 'active_documents_count') and store.active_documents_count is not None) else 0,
                    "pending_documents_count": int(store.pending_documents_count) if (hasattr(store, 'pending_documents_count') and store.pending_documents_count is not None) else 0,
                    "failed_documents_count": int(store.failed_documents_count) if (hasattr(store, 'failed_documents_count') and store.failed_documents_count is not None) else 0,
                    "size_bytes": int(store.size_bytes) if (hasattr(store, 'size_bytes') and store.size_bytes is not None) else 0
                }

            response = self._rest_request("GET", f"{BASE_URL}/{store_name}")
            response.raise_for_status()
            store = response.json()
            normalized = self._normalize_store(store)

            self.logger.info(f"FileSearchStore retrieved successfully: {store_name}")
            return {
                "success": True,
                "store_name": normalized.get("store_name"),
                "display_name": normalized.get("display_name"),
                "create_time": normalized.get("create_time"),
                "update_time": normalized.get("update_time"),
                "active_documents_count": normalized.get("active_documents_count", 0),
                "pending_documents_count": normalized.get("pending_documents_count", 0),
                "failed_documents_count": normalized.get("failed_documents_count", 0),
                "size_bytes": normalized.get("size_bytes", 0),
            }
        except Exception as e:
            self.logger.error(f"Error getting FileSearchStore {store_name}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def delete_file_search_store(self, store_name: str) -> Dict[str, Any]:
        """
        Delete a FileSearchStore

        Args:
            store_name: Name of the store to delete

        Returns:
            Dict with success status
        """
        try:
            self.logger.info(f"Deleting FileSearchStore: {store_name}")

            if self._supports_file_search_stores():
                self.client.file_search_stores.delete(name=store_name)

                self.logger.info(f"FileSearchStore deleted successfully: {store_name}")
                return {
                    "success": True,
                    "message": f"FileSearchStore {store_name} deleted successfully"
                }

            response = self._rest_request("DELETE", f"{BASE_URL}/{store_name}")
            if response.status_code not in (200, 204):
                error_detail = None
                try:
                    error_payload = response.json()
                    error_detail = error_payload.get("error", {}).get("message")
                except ValueError:
                    error_detail = response.text
                message = error_detail or response.text or f"HTTP {response.status_code}"
                raise RuntimeError(f"Delete failed: {message}")

            self.logger.info(f"FileSearchStore deleted successfully: {store_name}")
            return {
                "success": True,
                "message": f"FileSearchStore {store_name} deleted successfully"
            }
        except Exception as e:
            self.logger.error(f"Error deleting FileSearchStore {store_name}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def list_documents_in_store(
        self,
        store_name: str,
        page_size: Optional[int] = None,
        page_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        List all documents in a FileSearchStore

        Args:
            store_name: Name of the FileSearchStore
            page_size: Maximum documents per page
            page_token: Token for the next page

        Returns:
            Dict with success status and list of documents
        """
        try:
            self.logger.info(f"Listing documents in FileSearchStore: {store_name}")

            document_list = []
            next_page_token = None
            use_rest = page_token is not None or page_size is not None

            if self._supports_file_search_stores() and not use_rest:
                documents = self.client.file_search_stores.documents.list(
                    parent=store_name
                )

                for doc in documents:
                    file_id = None
                    if hasattr(doc, "file"):
                        file_ref = getattr(doc, "file")
                        if isinstance(file_ref, str):
                            file_id = file_ref
                        elif hasattr(file_ref, "name"):
                            file_id = getattr(file_ref, "name")
                    if not file_id and hasattr(doc, "file_id"):
                        file_id = getattr(doc, "file_id")
                    if not file_id and hasattr(doc, "file_name"):
                        file_id = getattr(doc, "file_name")

                    doc_info = {
                        "document_name": doc.name if hasattr(doc, 'name') else None,
                        "display_name": doc.display_name if hasattr(doc, 'display_name') else None,
                        "mime_type": doc.mime_type if hasattr(doc, 'mime_type') else None,
                        "create_time": str(doc.create_time) if hasattr(doc, 'create_time') else None,
                        "update_time": str(doc.update_time) if hasattr(doc, 'update_time') else None,
                        "size_bytes": doc.size_bytes if hasattr(doc, 'size_bytes') else None,
                        "file_id": file_id,
                    }
                    document_list.append(doc_info)
            else:
                params: Dict[str, str] = {}
                if page_size:
                    params["pageSize"] = str(page_size)
                if page_token:
                    params["pageToken"] = page_token

                response = self._rest_request(
                    "GET",
                    f"{BASE_URL}/{store_name}/documents",
                    params=params,
                )
                response.raise_for_status()
                data = response.json()
                documents = data.get("documents") or data.get("fileSearchDocuments") or []
                for doc in documents:
                    if isinstance(doc, dict):
                        document_list.append(self._normalize_document(doc))
                next_page_token = data.get("nextPageToken")

            self.logger.info(f"Found {len(document_list)} documents in store {store_name}")
            return {
                "success": True,
                "documents": document_list,
                "count": len(document_list),
                "store_name": store_name,
                "next_page_token": next_page_token
            }
        except Exception as e:
            self.logger.error(f"Error listing documents in store {store_name}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "documents": []
            }

    def delete_store_document(self, store_name: str, document_name: str) -> Dict[str, Any]:
        """
        Remove a document from a FileSearchStore

        Args:
            store_name: Name of the FileSearchStore
            document_name: Document resource name or id

        Returns:
            Dict with success status
        """
        try:
            self.logger.info(f"Deleting document {document_name} from store {store_name}")

            document_resource = document_name
            if not document_resource.startswith("fileSearchStores/"):
                document_resource = f"{store_name}/documents/{document_name}"

            response = self._rest_request("DELETE", f"{BASE_URL}/{document_resource}")
            if response.status_code not in (200, 204):
                error_detail = None
                try:
                    error_payload = response.json()
                    error_detail = error_payload.get("error", {}).get("message")
                except ValueError:
                    error_detail = response.text
                message = error_detail or response.text or f"HTTP {response.status_code}"

                if "Cannot delete non-empty Document" in message:
                    response = self._rest_request(
                        "DELETE",
                        f"{BASE_URL}/{document_resource}",
                        params={"force": "true"},
                    )
                    if response.status_code in (200, 204):
                        self.logger.info(f"Document removed successfully (force): {document_resource}")
                        return {
                            "success": True,
                            "document_name": document_resource,
                            "message": "Document removed from store"
                        }

                    try:
                        error_payload = response.json()
                        error_detail = error_payload.get("error", {}).get("message")
                    except ValueError:
                        error_detail = response.text
                    message = error_detail or response.text or f"HTTP {response.status_code}"

                raise RuntimeError(f"Remove failed: {message}")

            self.logger.info(f"Document removed successfully: {document_resource}")
            return {
                "success": True,
                "document_name": document_resource,
                "message": "Document removed from store"
            }
        except Exception as e:
            self.logger.error(
                f"Error removing document {document_name} from store {store_name}: {str(e)}",
                exc_info=True,
            )
            return {
                "success": False,
                "error": str(e)
            }

    # ==================== File Management Methods ====================

    def upload_file(self, file_path: str) -> Dict[str, Any]:
        """
        Upload a file to Files API

        Args:
            file_path: Path to the file to upload

        Returns:
            Dict with success status and file information
        """
        try:
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                self.logger.error(f"File not found: {file_path}")
                return {
                    "success": False,
                    "error": f"File not found: {file_path}"
                }

            self.logger.info(f"Uploading file: {file_path}")

            # Upload file using Files API - pass file path as string
            uploaded_file = self.client.files.upload(
                file=file_path,
                config={'display_name': os.path.basename(file_path)}
            )

            self.logger.info(f"File uploaded successfully: {uploaded_file.name}")
            return {
                "success": True,
                "file_id": uploaded_file.name,
                "display_name": uploaded_file.display_name,
                "mime_type": uploaded_file.mime_type if hasattr(uploaded_file, 'mime_type') else None,
                "size_bytes": uploaded_file.size_bytes if hasattr(uploaded_file, 'size_bytes') else None,
                "create_time": str(uploaded_file.create_time) if hasattr(uploaded_file, 'create_time') else None,
                "update_time": str(uploaded_file.update_time) if hasattr(uploaded_file, 'update_time') else None,
                "uri": uploaded_file.uri if hasattr(uploaded_file, 'uri') else None
            }
        except Exception as e:
            self.logger.error(f"Error uploading file {file_path}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def import_file_to_store(self, file_id: str, store_name: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Import a file from Files API to a FileSearchStore

        Args:
            file_id: ID of the file to import (from Files API)
            store_name: Name of the target FileSearchStore
            metadata: Optional metadata for the file

        Returns:
            Dict with success status
        """
        try:
            self.logger.info(f"Importing file {file_id} to store {store_name}")

            # Import file to the store
            if self._supports_file_search_stores():
                if metadata:
                    self.client.file_search_stores.import_file(
                        store_name=store_name,
                        file_id=file_id,
                        metadata=metadata
                    )
                else:
                    self.client.file_search_stores.import_file(
                        store_name=store_name,
                        file_id=file_id
                    )

                self.logger.info(f"File imported successfully to store {store_name}")
                return {
                    "success": True,
                    "file_id": file_id,
                    "store_name": store_name,
                    "message": "File imported successfully"
                }

            file_name = file_id
            if not file_name.startswith("files/"):
                file_name = f"files/{file_name}"

            payload: Dict[str, Any] = {"fileName": file_name}
            if metadata:
                payload["customMetadata"] = metadata

            endpoints = [
                f"{BASE_URL}/{store_name}:importFile",
                f"{BASE_URL}/{store_name}:import",
            ]

            last_error = None
            for endpoint in endpoints:
                response = self._rest_request("POST", endpoint, json_body=payload)
                if response.ok:
                    data = response.json() if response.content else {}
                    operation_name = data.get("name")
                    if operation_name:
                        self._poll_operation(operation_name)
                    self.logger.info(f"File imported successfully to store {store_name}")
                    return {
                        "success": True,
                        "file_id": file_id,
                        "store_name": store_name,
                        "message": "File imported successfully"
                    }
                last_error = f"{response.status_code} {response.text}"

            raise RuntimeError(f"Import failed: {last_error}")
        except Exception as e:
            self.logger.error(f"Error importing file {file_id} to store {store_name}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def upload_and_import_to_store(self, file_path: str, store_name: str, display_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Upload a file and directly import it to a FileSearchStore

        Args:
            file_path: Path to the file to upload
            store_name: Name of the target FileSearchStore
            display_name: Optional display name for the file

        Returns:
            Dict with success status and file information
        """
        try:
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                self.logger.error(f"File not found: {file_path}")
                return {
                    "success": False,
                    "error": f"File not found: {file_path}"
                }

            self.logger.info(f"Uploading and importing file {file_path} to store {store_name}")

            if self._supports_file_search_stores():
                # Upload and import in one step - pass file path as string
                self.client.file_search_stores.upload_to_file_search_store(
                    file=file_path,
                    file_search_store_name=store_name,
                    config={'display_name': display_name or os.path.basename(file_path)}
                )

                self.logger.info(f"File uploaded and imported successfully to store {store_name}")
                return {
                    "success": True,
                    "store_name": store_name,
                    "file_path": file_path,
                    "message": "File uploaded and imported successfully"
                }

            upload_url = f"{UPLOAD_BASE_URL}/{store_name}:uploadToFileSearchStore"
            file_name = display_name or os.path.basename(file_path)
            mime_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
            extension = os.path.splitext(file_name)[1].lower()
            if extension in {".md", ".markdown"}:
                mime_type = "text/plain"
            metadata = {"displayName": file_name}

            with open(file_path, "rb") as file_handle:
                files = {
                    "metadata": ("metadata", json.dumps(metadata), "application/json"),
                    "file": (file_name, file_handle, mime_type),
                }
                response = self._rest_request(
                    "POST",
                    upload_url,
                    params={"uploadType": "multipart"},
                    files=files,
                    timeout=UPLOAD_TIMEOUT,
                )
                response.raise_for_status()
                data = response.json()

            operation_name = data.get("name")
            if operation_name:
                self._poll_operation(operation_name)

            self.logger.info(f"File uploaded and imported successfully to store {store_name}")
            return {
                "success": True,
                "store_name": store_name,
                "file_path": file_path,
                "message": "File uploaded and imported successfully"
            }
        except Exception as e:
            self.logger.error(f"Error uploading and importing file {file_path} to store {store_name}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def delete_file(self, file_id: str) -> Dict[str, Any]:
        """
        Delete a file from Files API

        Args:
            file_id: ID of the file to delete

        Returns:
            Dict with success status
        """
        try:
            self.logger.info(f"Deleting file: {file_id}")

            self.client.files.delete(name=file_id)

            self.logger.info(f"File deleted successfully: {file_id}")
            return {
                "success": True,
                "file_id": file_id,
                "message": f"File {file_id} deleted successfully"
            }
        except Exception as e:
            self.logger.error(f"Error deleting file {file_id}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    def list_files(self) -> Dict[str, Any]:
        """
        List all uploaded files

        Returns:
            Dict with success status and list of files
        """
        try:
            self.logger.info("Listing all files")

            files = self.client.files.list()
            file_list = []

            for file in files:
                file_info = {
                    "file_id": file.name,
                    "display_name": file.display_name,
                    "mime_type": file.mime_type if hasattr(file, 'mime_type') else None,
                    "size_bytes": file.size_bytes if hasattr(file, 'size_bytes') else None,
                    "create_time": str(file.create_time) if hasattr(file, 'create_time') else None,
                    "update_time": str(file.update_time) if hasattr(file, 'update_time') else None,
                    "uri": file.uri if hasattr(file, 'uri') else None
                }
                file_list.append(file_info)

            self.logger.info(f"Found {len(file_list)} files")
            return {
                "success": True,
                "files": file_list,
                "count": len(file_list)
            }
        except Exception as e:
            self.logger.error(f"Error listing files: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "files": []
            }

    def get_file(self, file_id: str) -> Dict[str, Any]:
        """
        Get information about a specific file

        Args:
            file_id: ID of the file to retrieve

        Returns:
            Dict with success status and file information
        """
        try:
            self.logger.info(f"Getting file info: {file_id}")

            file = self.client.files.get(name=file_id)

            self.logger.info(f"File info retrieved successfully: {file_id}")
            return {
                "success": True,
                "file_id": file.name,
                "display_name": file.display_name,
                "mime_type": file.mime_type if hasattr(file, 'mime_type') else None,
                "size_bytes": file.size_bytes if hasattr(file, 'size_bytes') else None,
                "create_time": str(file.create_time) if hasattr(file, 'create_time') else None,
                "update_time": str(file.update_time) if hasattr(file, 'update_time') else None,
                "uri": file.uri if hasattr(file, 'uri') else None,
                "state": file.state.name if hasattr(file, 'state') else None
            }
        except Exception as e:
            self.logger.error(f"Error getting file {file_id}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    # ==================== Search Methods ====================

    def search_with_file_search(
        self,
        query: str,
        store_names: List[str],
        metadata_filter: Optional[str] = None,
        model: str = "gemini-2.5-flash"
    ) -> Dict[str, Any]:
        """
        Search using FileSearch tool with specified stores

        Args:
            query: Search query
            store_names: List of FileSearchStore names to search in
            metadata_filter: Optional metadata filter expression for search
            model: Model to use for search (default: gemini-2.5-flash)

        Returns:
            Dict with success status and search results
        """
        try:
            self.logger.info(f"Searching with FileSearch in stores: {store_names}")
            self.logger.debug(f"Query: {query}")
            self.logger.debug(f"Metadata filter: {metadata_filter}")

            data = self._generate_content_with_file_search(
                query,
                store_names,
                model,
                metadata_filter=metadata_filter,
            )
            result_text = self._extract_text_from_generate_content(data)
            citations = self._extract_citations(data)

            self.logger.info(f"Search completed successfully")
            self.logger.debug(f"Result length: {len(result_text)} characters")

            return {
                "success": True,
                "query": query,
                "result": result_text,
                "citations": citations,
                "stores_searched": store_names,
                "model": model
            }
        except Exception as e:
            self.logger.error(f"Error in FileSearch: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "query": query
            }

    def search_with_grounding(
        self,
        query: str,
        store_names: List[str],
        model: str = "gemini-2.5-flash"
    ) -> Dict[str, Any]:
        """
        Search using grounding with FileSearchStores

        Args:
            query: Search query
            store_names: List of FileSearchStore names for grounding
            model: Model to use for search (default: gemini-2.5-flash)

        Returns:
            Dict with success status and search results with grounding metadata
        """
        try:
            self.logger.info(f"Searching with grounding in stores: {store_names}")
            self.logger.debug(f"Query: {query}")

            data = self._generate_content_with_file_search(query, store_names, model)
            result_text = self._extract_text_from_generate_content(data)

            grounding_metadata = None
            candidates = data.get("candidates") or []
            if candidates:
                candidate = candidates[0] or {}
                grounding_metadata = candidate.get("groundingMetadata") or candidate.get("grounding_metadata")
                if grounding_metadata is not None:
                    grounding_metadata = str(grounding_metadata)

            self.logger.info(f"Grounding search completed successfully")

            return {
                "success": True,
                "query": query,
                "result": result_text,
                "stores_searched": store_names,
                "grounding_metadata": grounding_metadata,
                "model": model
            }
        except Exception as e:
            self.logger.error(f"Error in grounding search: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "query": query
            }
