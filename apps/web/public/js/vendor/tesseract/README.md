OCR for js/ocr.js, loaded only when OCR is run (not part of the offline shell).

- tesseract.min.js, worker.min.js: tesseract.js 5.1.1 (Apache-2.0, LICENSE)
- tesseract-core-simd-lstm.wasm.js, tesseract-core-lstm.wasm.js: tesseract.js-core 5.1.1
  (Apache-2.0, LICENSE.core); the SIMD build where the browser has it, the other where not
- lang/eng.traineddata.gz, lang/ara.traineddata.gz: @tesseract.js-data eng and ara,
  4.0.0_best_int (Apache-2.0, from tesseract-ocr/tessdata_best)

To update: npm i tesseract.js@5 tesseract.js-core@5 @tesseract.js-data/eng @tesseract.js-data/ara
in a scratch folder and copy the same files over.
