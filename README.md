# Image Brainstorm

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

A visual brainstorming tool for AI image generation. Generate grids of image variations using Google Gemini via OpenRouter, then select, crop, and refine parts you like in an iterative creative loop.

## Features

- **Prompt-to-image generation** via Gemini (OpenRouter API)
- **Grid variations** — generate 2x2 up to 5x5 grids with style, mood, angle, color, or random variations
- **Crop & refine** — select regions of generated images and use them as references for new generations
- **Draggable canvas** — arrange image cards freely on an infinite canvas
- **Resizable cards** — drag card corners to zoom in on details
- **Drag & drop** — drop your own images onto the canvas
- **Image-to-image** — use any image as a reference for the next generation
- **Session persistence** — boards auto-save to localStorage
- **Session history** — save and restore previous brainstorm sessions
- **Floating palette** — compact, draggable prompt panel

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env with your API key
echo "OPENROUTER_API_KEY=your-key-here" > .env

# Start the server
uvicorn main:app --port 8800 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:5174` and proxies API requests to the backend on port 8800.

## How it works

1. Write a prompt describing the image you want
2. Choose grid size and variation type
3. Hit **Generate** — a placeholder card appears immediately, replaced by the result when ready
4. **Select a region** on any image (click and drag) to crop it as a reference
5. **Pin** an image to use it as a reference for image-to-image generation
6. Repeat — refine your prompt, add references, generate again
7. Drag cards around to build your mood board

## Tech stack

- **Backend**: FastAPI, OpenAI SDK (OpenRouter), Pillow
- **Frontend**: React, Vite
- **AI**: Google Gemini 3.1 Flash Image via OpenRouter

## License

MIT
