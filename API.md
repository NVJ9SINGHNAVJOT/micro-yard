# Storage Service API

A personal file storage service. Upload files and retrieve them by ID. Files are stored on the local filesystem and categorised automatically by MIME type.

## Configuration

| Variable | Default | Description                     |
| -------- | ------- | ------------------------------- |
| `PORT`   | `8080`  | Port the HTTP server listens on |

Base URL: `http://localhost:9000`

---

## Response Envelope

Every response — success or error — is JSON with `Content-Type: application/json`.

Success:

```json
{ "data": <payload> }
```

Error:

```json
{ "error": { "message": "<description>" } }
```

---

## Media Object

Returned by upload, get metadata, and list endpoints.

| Field              | Type             | Description                            |
| ------------------ | ---------------- | -------------------------------------- |
| `id`               | string (UUID v4) | Unique identifier for the file         |
| `filename`         | string           | Name of the file stored on disk        |
| `originalFilename` | string           | Original filename from the upload      |
| `mimeType`         | string           | Detected MIME type                     |
| `size`             | number           | File size in bytes                     |
| `category`         | string           | Auto-assigned category (see below)     |
| `createdAt`        | string (ISO 8601)| Upload timestamp in UTC                |

---

## File Categories

Assigned automatically from the detected MIME type.

| MIME type                                         | `category` value |
| ------------------------------------------------- | ---------------- |
| `image/*`                                         | `images`         |
| `video/*`                                         | `videos`         |
| `audio/*`                                         | `audio`          |
| `application/pdf`, `text/*`, `application/msword` | `documents`      |
| anything else                                     | `others`         |

---

## Endpoints

### GET /health

Check that the server is running.

Response `200`:

```json
{ "data": { "status": "ok" } }
```

---

### GET /api/media

List metadata for stored files. Supports filtering, sorting, and pagination via query parameters. Returns an empty array when no files match.

#### Query Parameters

| Parameter | Type   | Default      | Description |
| --------- | ------ | ------------ | ----------- |
| `category`| string | _(empty)_    | Filter by category: `images`, `videos`, `audio`, `documents`, `others` |
| `sort_by` | string | `created_at` | Sort field: `size`, `created_at` |
| `order`   | string | `desc`       | Sort order: `asc`, `desc` |
| `limit`   | int    | `50`         | Max items per page (clamped 1–100) |
| `offset`  | int    | `0`          | Number of items to skip |

Example Request: `GET /api/media?category=images&sort_by=size&order=desc&limit=50&offset=0`

Response `200`:

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789",
      "filename": "photo.jpg",
      "originalFilename": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 2456789,
      "category": "images",
      "createdAt": "2026-06-14T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 237,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

Response `500` — storage directory walk failed:

```json
{ "error": { "message": "failed to list media" } }
```

---

### GET /api/media/{id}

Get metadata for a single file.

Path parameter — `id`: UUID v4 returned by the upload endpoint.

Response `200` — Media object:

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789",
    "filename": "photo.jpg",
    "originalFilename": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 2456789,
    "category": "images",
    "createdAt": "2026-06-14T12:00:00Z"
  }
}
```

Response `404` — no file exists with that ID:

```json
{ "error": { "message": "media not found" } }
```

---

### GET /api/media/{id}/file

Download the original file. The response `Content-Type` matches the file's MIME type. Supports HTTP range requests (byte-range streaming for video and audio).

Path parameter — `id`: UUID v4 returned by the upload endpoint.

Response `200` — raw file bytes with appropriate `Content-Type`.

Response `404` — no file exists with that ID:

```json
{ "error": { "message": "media not found" } }
```

Response `500` — file exists but metadata is unreadable:

```json
{ "error": { "message": "failed to read metadata" } }
```

---

### DELETE /api/media/{id}

Permanently delete a file and its metadata. This action cannot be undone.

Path parameter — `id`: UUID v4 returned by the upload endpoint.

Response `200`:

```json
{ "data": { "deleted": true } }
```

Response `404` — no file exists with that ID:

```json
{ "error": { "message": "media not found" } }
```

---

## Integration Workflow

A typical client flow:

1. Use `GET /api/media?category=images&sort_by=created_at&order=desc` to list and filter stored files.
2. Use `GET /api/media/{id}` to retrieve metadata for a specific file.
3. Use `GET /api/media/{id}/file` to stream or download the original file.
4. Use `DELETE /api/media/{id}` to remove the file when no longer needed.
