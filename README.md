# Stover

Stover classifies every pixel of a downward-facing field photo as crop residue, green canopy, or bare soil, and
reports residue cover, canopy cover, and total ground cover.

- **Website:** [soilwater.github.io/stover](https://soilwater.github.io/stover)
- **Web app:** [soilwater.github.io/stover/app](https://soilwater.github.io/stover/app/) (runs in the browser, and images are not uploaded)
- **Windows app:** `Stover-<version>-setup.exe` on the [Releases](https://github.com/soilwater/stover/releases) page.
  It classifies photos and videos and uses the computer's graphics card when there is one.
- **Dataset v2:** 5,000 images at 1024 x 1024 with pixel labels, as five zip files:
  [dataset-v2](https://github.com/soilwater/stover/releases/tag/dataset-v2)
- **Dataset v1:** 3,510 images at 512 x 512 with labels, a lighter version:
  [dataset-v1](https://github.com/soilwater/stover/releases/tag/dataset-v1)
- **Sample:** 100 images from dataset v2 in `dataset_sample/`, also in the online
  [Dataset Explorer](https://soilwater.github.io/stover/app/dataset.html)

Labels are PNG files with one value per pixel: 0 soil, 1 plant (green canopy), 2 residue.

## Cite

Please cite the paper when you use the apps or the dataset:

> Patrignani, A., Bisheh, M., & Nahitiya, D. (in press). Segmenting crop residue, canopy, and soil in field images:
> An open dataset and the Stover tool. *Agronomy Journal*.

## License

Free for research, extension, and teaching under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`).
For questions or collaborations, write to andrespatrignani@ksu.edu.
