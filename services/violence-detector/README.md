# Violence Detector Service

This service runs `modelnew.h5` and `vgg16_model.h5` and exposes:

- `POST /predict` (frame analysis)
- `GET /health`

## 1) Install

```bash
cd services/violence-detector
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2) Put models in default folder (recommended)

Copy both files into:

`services/violence-detector/models/`

Expected filenames:

- `modelnew.h5`
- `vgg16_model.h5`

No path edits are needed if you use this folder.

## 3) Optional: override model paths with env vars

PowerShell (Windows):

```powershell
$env:MODELNEW_PATH="D:\models\modelnew.h5"
$env:VGG16_MODEL_PATH="D:\models\vgg16_model.h5"
$env:VIOLENCE_THRESHOLD="0.70"
```

Bash (macOS/Linux):

```bash
export MODELNEW_PATH="/opt/models/modelnew.h5"
export VGG16_MODEL_PATH="/opt/models/vgg16_model.h5"
export VIOLENCE_THRESHOLD="0.70"
```

## 4) Run API

```bash
uvicorn app:app --host 127.0.0.1 --port 8001
```

Your Next.js app should set:

```env
VIOLENCE_DETECTOR_URL=http://127.0.0.1:8001/predict
```

## Notes

- The Next app captures camera frames, calls `/api/violence-detect`, and forwards to this service.
- When violence is detected, Next assembles a rolling 15-second video + short audio clip and posts it to `/api/emergency-dispatch`.
- To actually store/share media files, set `EVIDENCE_RELAY_URL` to your storage/notification backend.
- If models are missing, service startup fails with a clear error showing where files are expected.
