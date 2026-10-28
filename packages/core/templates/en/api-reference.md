---
template:
  version: 1
  name: API reference
  description: The contract of an API, for whoever integrates with it
  category: reference
---

# {{title}}

What the API is for, in one or two sentences.

## Authentication

How to get a token and where to send it.

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/items
```

## Endpoints

### List items

`GET /v1/items`

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| limit     | number | How many items, up to 100  |
| cursor    | string | Where the next page starts |

Example response:

```json
{
  "items": [],
  "next": null
}
```

Errors: what each error code means here.

## Limits

How many requests per minute, and what happens above it.

## Versions

How versions change, and how long an old version keeps working.
