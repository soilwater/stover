# Stover

**Stover** classifies **crop residue**, **green canopy**, and **bare soil** at the pixel level from downward-facing (nadir) field images, using a U-Net convolutional neural network. It runs entirely in your browser — no upload, no account, no server — and this repository also hosts the **open training dataset** and the **trained model**.

Trained on **corn, grain sorghum, soybean, sunflower, and winter wheat** fields representative of the U.S. Great Plains, Stover may also generalize to other cropping systems. For the most accurate **residue** estimates, capture images when little or no live vegetation is present.

---

## 🌱 Use the tool

**▶ Open Stover:** [soilwater.github.io/stover](https://soilwater.github.io/stover)

Everything runs locally in your browser — images never leave your device.

* **Batch processing** — drag in (or select) many images at once.
* **Outputs** — per-image cover percentages (soil / plant / residue), a **CSV** (with timestamp and GPS/EXIF metadata when available), a **PDF report**, and a **ZIP** of the 512 × 512 images and their segmentation masks.
* **Uncertainty** view to highlight low-confidence areas.
* **Installable** (Progressive Web App) and works **offline** after the first visit. The model (~70 MB) is cached on first use.

### 📸 Capturing good images

Hold the camera about **1 m above the ground (waist height)**, lens pointing **straight down**, framing roughly one square meter. Shoot in **daylight** (about 10:00–16:00) to avoid long shadows and glare. To cover more area, take **multiple photos** rather than raising the camera higher. See **Help → Collecting images** in the app for illustrated do / don't examples.

---

## 📂 Open dataset

A manually labeled dataset of **3,510 field images** lives in [`dataset_v1/`](dataset_v1):

| Folder | Contents |
| --- | --- |
| `image_data/` | Original RGB field images — `image_XXXX.jpg` |
| `label_data/` | Pixel class labels (lossless PNG): `0 = soil`, `1 = plant`, `2 = residue` — `label_XXXX.png` |
| `mask_data/`  | Colored versions of the labels, for display — `mask_XXXX.png` |

**🔎 Browse it online:** [Dataset Explorer](https://soilwater.github.io/stover/dataset.html)

---

## 🧠 Model

A from-scratch **U-Net** (48 initial features, ~17.5 M parameters) trained on the dataset above, reaching **~96% overall accuracy** on a held-out test set. The training checkpoint is in [`models/`](models).

---

## 📁 Repository layout

```
dataset_v1/   open dataset — image_data / label_data / mask_data
docs/         the Stover web app + dataset explorer (served via GitHub Pages)
models/       trained model checkpoint
LICENSE       MIT
```

---

## 📖 Citation

If you use Stover, the dataset, or the model, please cite:

> Patrignani, A., Bisheh, M, Naithiya, D. 2026. *Segmenting Crop Residue, Canopy, and Soil in Field Images: An Open Dataset and the Stover Tool.* Under review in Agronomy Journal. 

*Manuscript in review at Agronomy Journal; a preprint is available on ESS Open Archive.*

---

## ⚖️ License

Released under the [MIT License](LICENSE).
