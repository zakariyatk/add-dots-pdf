//! Text read from a page picture by Windows' own OCR (Windows.Media.Ocr),
//! for js/ocr.js: much faster than Tesseract in WebAssembly, and nothing to
//! download. Tesseract stays the fallback (the website, a language Windows
//! has no recogniser for, any error here).
//!
//! The page draws the page and sends its pixels (RGBA, the request's body,
//! `x-w` x `x-h`) with the language (`x-lang`, a BCP-47 tag such as `en-US`,
//! one of those `ocr_status` lists). The words come back with their boxes in
//! those pixels, in reading order, a line at a time.

/// What this computer can read: its recognisers' languages, and the largest
/// side of a picture they take (Windows says; bigger pictures are refused).
#[derive(serde::Serialize, Default)]
pub struct Status {
    pub languages: Vec<String>,
    pub max: u32,
}

/// A word and its box, in the picture's pixels; `line` counts the lines.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Word {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub line: u32,
}

/// RGBA as the page's canvas gives it, to the BGRA a SoftwareBitmap takes.
#[cfg_attr(not(windows), allow(dead_code))]
fn rgba_to_bgra(px: &mut [u8]) {
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
    }
}

/// The pixels' size is checked against what was said: w x h x 4 bytes.
pub fn check_size(len: usize, w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 || (w as u64) * (h as u64) * 4 != len as u64 {
        return Err(format!("{len} bytes are not a {w}x{h} picture"));
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::{Status, Word};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    /// Off the window's thread, which is single-threaded COM: these calls
    /// block, and Windows asks for the multithreaded kind. A thread that
    /// already has it set answers an error here, which changes nothing.
    fn com() {
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    pub fn status() -> windows::core::Result<Status> {
        com();
        let mut languages = vec![];
        for l in OcrEngine::AvailableRecognizerLanguages()? {
            languages.push(l.LanguageTag()?.to_string());
        }
        Ok(Status { languages, max: OcrEngine::MaxImageDimension()? })
    }

    pub fn read(mut px: Vec<u8>, w: u32, h: u32, lang: &str) -> Result<Vec<Word>, String> {
        let e = |e: windows::core::Error| e.message().to_string();
        com();
        super::rgba_to_bgra(&mut px);
        let writer = DataWriter::new().map_err(e)?;
        writer.WriteBytes(&px).map_err(e)?;
        let buf = writer.DetachBuffer().map_err(e)?;
        let bmp = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buf,
            BitmapPixelFormat::Bgra8,
            w as i32,
            h as i32,
            BitmapAlphaMode::Premultiplied,
        )
        .map_err(e)?;
        let language = Language::CreateLanguage(&HSTRING::from(lang)).map_err(e)?;
        let engine = OcrEngine::TryCreateFromLanguage(&language)
            .map_err(|_| format!("Windows cannot read {lang} on this computer"))?;
        let result = engine.RecognizeAsync(&bmp).map_err(e)?.join().map_err(e)?;
        let mut words = vec![];
        for (n, line) in result.Lines().map_err(e)?.into_iter().enumerate() {
            for word in line.Words().map_err(e)? {
                let r = word.BoundingRect().map_err(e)?;
                let text = word.Text().map_err(e)?.to_string();
                words.push(Word { text, x: r.X, y: r.Y, w: r.Width, h: r.Height, line: n as u32 });
            }
        }
        Ok(words)
    }
}

/// What Windows can read here; none at all off Windows.
pub fn status() -> Status {
    #[cfg(windows)]
    {
        win::status().unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Status::default()
    }
}

/// The words on a picture (RGBA, w x h), in the language `lang`.
pub fn read(px: Vec<u8>, w: u32, h: u32, lang: &str) -> Result<Vec<Word>, String> {
    check_size(px.len(), w, h)?;
    #[cfg(windows)]
    {
        win::read(px, w, h, lang)
    }
    #[cfg(not(windows))]
    {
        let _ = lang;
        Err("Windows' text reader is on Windows only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixels_turn_from_rgba_to_bgra() {
        let mut px = vec![1, 2, 3, 4, 5, 6, 7, 8];
        rgba_to_bgra(&mut px);
        assert_eq!(px, vec![3, 2, 1, 4, 7, 6, 5, 8]);
    }

    #[test]
    fn a_picture_must_be_the_size_it_says() {
        assert!(check_size(16, 2, 2).is_ok());
        assert!(check_size(15, 2, 2).is_err());
        assert!(check_size(0, 0, 0).is_err());
        assert!(read(vec![0; 12], 2, 2, "en-US").is_err());
    }

    /// On Windows, a picture of nothing reads as no words (and the
    /// recogniser answers at all); elsewhere there is no recogniser.
    #[test]
    fn a_blank_page_has_no_words() {
        let s = status();
        if cfg!(windows) && !s.languages.is_empty() {
            assert!(s.max >= 1000, "{}", s.max);
            let lang = s.languages[0].clone();
            assert_eq!(read(vec![255; 200 * 100 * 4], 200, 100, &lang).unwrap(), vec![]);
        } else {
            assert!(s.languages.is_empty());
        }
    }
}
