import io
import os
from pathlib import Path
from typing import Tuple

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image
from tensorflow.keras.models import load_model

app = FastAPI(title="Violence Detector Service")

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODELS_DIR = BASE_DIR / "models"
MODELNEW_PATH = Path(os.getenv("MODELNEW_PATH", str(DEFAULT_MODELS_DIR / "modelnew.h5")))
VGG16_MODEL_PATH = Path(os.getenv("VGG16_MODEL_PATH", str(DEFAULT_MODELS_DIR / "vgg16_model.h5")))
THRESHOLD = float(os.getenv("VIOLENCE_THRESHOLD", "0.70"))
INPUT_SIZE = int(os.getenv("MODEL_INPUT_SIZE", "224"))


def _ensure_model_exists(path: Path, env_name: str) -> None:
    if path.exists():
        return
    raise RuntimeError(
        f"Missing model file: {path}. "
        f"Set {env_name} or place the model in {DEFAULT_MODELS_DIR}."
    )


_ensure_model_exists(MODELNEW_PATH, "MODELNEW_PATH")
_ensure_model_exists(VGG16_MODEL_PATH, "VGG16_MODEL_PATH")

model_new = load_model(str(MODELNEW_PATH))
model_vgg = load_model(str(VGG16_MODEL_PATH))


class PredictRequest(BaseModel):
    frameDataUrl: str


def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Invalid data URL format.")
    _, b64_data = data_url.split(",", 1)
    import base64

    return base64.b64decode(b64_data)


def preprocess(image_bytes: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize((INPUT_SIZE, INPUT_SIZE))
    array = np.asarray(image).astype("float32") / 255.0
    return np.expand_dims(array, axis=0)


def extract_violence_probability(raw_prediction: np.ndarray) -> float:
    flat = np.asarray(raw_prediction).astype("float32").reshape(-1)
    if flat.size == 1:
        return float(flat[0])
    if flat.size >= 2:
        return float(flat[1])
    return 0.0


def predict_probabilities(batch: np.ndarray) -> Tuple[float, float, float]:
    pred_new = model_new.predict(batch, verbose=0)
    pred_vgg = model_vgg.predict(batch, verbose=0)
    p_new = extract_violence_probability(pred_new)
    p_vgg = extract_violence_probability(pred_vgg)
    confidence = float((p_new + p_vgg) / 2.0)
    return p_new, p_vgg, confidence


@app.get("/health")
def health():
    return {
        "status": "ok",
        "modelnew_path": str(MODELNEW_PATH),
        "vgg16_model_path": str(VGG16_MODEL_PATH),
        "threshold": THRESHOLD,
    }


@app.post("/predict")
def predict(request: PredictRequest):
    image_bytes = decode_data_url(request.frameDataUrl)
    batch = preprocess(image_bytes)
    p_new, p_vgg, confidence = predict_probabilities(batch)
    violence_detected = confidence >= THRESHOLD

    return {
        "violenceDetected": bool(violence_detected),
        "confidence": confidence,
        "threshold": THRESHOLD,
        "provider": "tensorflow-dual-model",
        "scores": {
            "modelnew": p_new,
            "vgg16": p_vgg,
        },
    }
