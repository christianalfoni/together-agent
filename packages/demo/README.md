# Demo Application

A simple demo application showcasing a full-stack TypeScript setup with Vite and Express.

## Features

- **Frontend**: Vite + TypeScript
- **Backend**: Express API with TypeScript
- **Hot Reload**: Both client and server support hot reloading in development

## Development

Start the development server:

```bash
pnpm dev
```

This will start the Express server on port 3000, which serves:
- API endpoints at `/api/*`
- Vite dev server for the frontend

Open http://localhost:3000 in your browser.

## API Endpoints

- `GET /api/hello` - Returns a hello world message with timestamp

## Project Structure

```
demo/
├── server/          # Express API server
│   └── index.ts
├── src/             # Frontend source
│   ├── main.ts
│   └── style.css
├── index.html       # Entry HTML
└── vite.config.ts   # Vite configuration
```
