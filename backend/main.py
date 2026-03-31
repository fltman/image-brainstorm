"""Image Brainstorm API — generates images via Gemini/OpenRouter and supports grid cropping."""

import base64
import io
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from PIL import Image
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Image Brainstorm API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

IMAGES_DIR = Path(__file__).parent / "generated_images"
IMAGES_DIR.mkdir(exist_ok=True)

app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")


def get_client() -> OpenAI:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(500, "OPENROUTER_API_KEY not set")
    return OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)


def extract_image_from_response(response) -> bytes | None:
    """Pull base64 image data out of the Gemini response."""
    if not response.choices or not response.choices[0].message:
        return None
    msg = response.choices[0].message

    # OpenRouter returns inline_data images in the content parts
    if isinstance(msg.content, list):
        for part in msg.content:
            if isinstance(part, dict):
                # inline_data format
                if part.get("type") == "image_url":
                    url = part["image_url"]["url"]
                    if url.startswith("data:image"):
                        return base64.b64decode(url.split(",", 1)[1])
                # some models return inline_data directly
                if "inline_data" in part:
                    return base64.b64decode(part["inline_data"]["data"])
            # openai SDK objects
            if hasattr(part, "type") and part.type == "image_url":
                url = part.image_url.url
                if url.startswith("data:image"):
                    return base64.b64decode(url.split(",", 1)[1])

    # Legacy: images attribute
    if hasattr(msg, "images") and msg.images:
        for img in msg.images:
            if isinstance(img, dict) and img.get("type") == "image_url":
                url = img["image_url"]["url"]
                if url.startswith("data:image"):
                    return base64.b64decode(url.split(",", 1)[1])

    # Fallback: check if content is a string with base64 data
    if isinstance(msg.content, str) and msg.content.startswith("data:image"):
        return base64.b64decode(msg.content.split(",", 1)[1])

    return None


# ── Generate from text prompt ───────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    model: str = "google/gemini-3.1-flash-image-preview"


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    client = get_client()
    try:
        response = client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": req.prompt}],
        )
    except Exception as e:
        raise HTTPException(502, f"OpenRouter error: {e}")

    img_bytes = extract_image_from_response(response)
    if not img_bytes:
        # Return text response if no image
        text = ""
        msg = response.choices[0].message if response.choices else None
        if msg and msg.content:
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
        raise HTTPException(422, f"No image in response. Model said: {text[:500]}")

    filename = f"{uuid.uuid4().hex}.png"
    (IMAGES_DIR / filename).write_bytes(img_bytes)
    return {"image": f"/images/{filename}", "filename": filename}


# ── Generate from image + prompt (image-to-image) ──────────────────

class RefineRequest(BaseModel):
    prompt: str
    source_image: str  # filename in generated_images/
    model: str = "google/gemini-3.1-flash-image-preview"


@app.post("/api/refine")
async def refine(req: RefineRequest):
    source_path = IMAGES_DIR / req.source_image
    if not source_path.exists():
        raise HTTPException(404, "Source image not found")

    b64 = base64.b64encode(source_path.read_bytes()).decode()
    mime = "image/png"

    client = get_client()
    try:
        response = client.chat.completions.create(
            model=req.model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": req.prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }],
        )
    except Exception as e:
        raise HTTPException(502, f"OpenRouter error: {e}")

    img_bytes = extract_image_from_response(response)
    if not img_bytes:
        text = ""
        msg = response.choices[0].message if response.choices else None
        if msg and msg.content:
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
        raise HTTPException(422, f"No image in response. Model said: {text[:500]}")

    filename = f"{uuid.uuid4().hex}.png"
    (IMAGES_DIR / filename).write_bytes(img_bytes)
    return {"image": f"/images/{filename}", "filename": filename}


# ── Crop a region from an image ─────────────────────────────────────

class CropRequest(BaseModel):
    source_image: str  # filename
    x: int
    y: int
    width: int
    height: int


@app.post("/api/crop")
async def crop(req: CropRequest):
    source_path = IMAGES_DIR / req.source_image
    if not source_path.exists():
        raise HTTPException(404, "Source image not found")

    img = Image.open(source_path)
    cropped = img.crop((req.x, req.y, req.x + req.width, req.y + req.height))

    filename = f"{uuid.uuid4().hex}.png"
    cropped.save(IMAGES_DIR / filename, "PNG")
    return {"image": f"/images/{filename}", "filename": filename}


# ── Upload an external image ────────────────────────────────────────

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    filename = f"{uuid.uuid4().hex}.png"
    # Convert to PNG
    img = Image.open(io.BytesIO(data))
    img.save(IMAGES_DIR / filename, "PNG")
    return {"image": f"/images/{filename}", "filename": filename}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
