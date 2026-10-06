//! Text read from a page picture by Windows' own OCR (Windows.Media.Ocr),
//! for js/ocr.js: much faster than Tesseract in WebAssembly, and nothing to
//! download. Tesseract stays the fallback (the website, a language Windows
//! has no recogniser for, any error here).
//!
//! The page draws the page and sends its pixels (RGBA, the request's body,
//! `x-w` x `x-h`) with the language (`x-lang`, a BCP-47 tag such as `en-US`,
//! one of those `ocr_status` lists). The words come back with their boxes in
//! those pixels, in reading order, a line at a time.
//!
//! Two languages at once (`en-US,ar-SA`, for a page in English and Arabic):
//! Windows' recognisers read one language each, so the picture is read by
//! each, and the words are put together by `merge`.

/// What this computer can read: its recognisers' languages, and the largest
/// side of a picture they take (Windows says; bigger pictures are refused).
#[derive(serde::Serialize, Default)]
pub struct Status {
    pub languages: Vec<String>,
    pub max: u32,
}

/// A word and its box, in the picture's pixels; `line` counts the lines.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct Word {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub line: u32,
}

/// The languages asked for: one tag, or several with commas between.
pub fn languages(lang: &str) -> Result<Vec<String>, String> {
    let tags: Vec<String> = lang.split(',').map(|t| t.trim().to_string()).collect();
    let ok = |t: &String| !t.is_empty() && t.len() <= 20 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if tags.is_empty() || tags.len() > 3 || !tags.iter().all(ok) {
        return Err("not a language".into());
    }
    Ok(tags)
}

/// A language written in Arabic letters (Arabic, Persian, Urdu).
fn arabic_language(tag: &str) -> bool {
    let l = tag.to_ascii_lowercase();
    ["ar", "fa", "ur"].iter().any(|p| l == *p || l.starts_with(&format!("{p}-")))
}

fn has_arabic(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c as u32, 0x0600..=0x06FF | 0x0750..=0x077F | 0x08A0..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF))
}

/// Two boxes are one word's when they share most of the smaller one.
fn same_place(a: &Word, b: &Word) -> bool {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if w <= 0.0 || h <= 0.0 {
        return false;
    }
    w * h > (a.w * a.h).min(b.w * b.h).max(1.0) * 0.5
}

/// The words of one picture read in several languages, as one list. Each
/// recogniser reads every mark in its own letters, so where they disagree:
/// a word in Arabic letters, read by an Arabic recogniser, is taken from it
/// (another reads Arabic as Latin nonsense); every other word from the
/// other recognisers (an Arabic one reads Latin text worse); and a word one
/// read and no other did (digits, a word on its own) is kept as it is.
pub fn merge(passes: Vec<(String, Vec<Word>)>) -> Vec<Word> {
    if passes.len() == 1 {
        return passes.into_iter().next().map(|p| p.1).unwrap_or_default();
    }
    let (arabic, other): (Vec<_>, Vec<_>) = passes.into_iter().partition(|p| arabic_language(&p.0));
    let (mut kept, mut spare) = (vec![], vec![]);
    for w in arabic.into_iter().flat_map(|p| p.1) {
        if has_arabic(&w.text) { kept.push(w) } else { spare.push(w) }
    }
    /* lines numbered on from the Arabic reader's */
    let lines = kept.iter().map(|w: &Word| w.line + 1).max().unwrap_or(0);
    for mut w in other.into_iter().flat_map(|p| p.1) {
        if !kept.iter().any(|k| has_arabic(&k.text) && same_place(k, &w)) {
            w.line += lines;
            kept.push(w);
        }
    }
    for w in spare {
        if !kept.iter().any(|k| same_place(k, &w)) {
            kept.push(w);
        }
    }
    kept
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

    pub fn read(mut px: Vec<u8>, w: u32, h: u32, langs: &[String]) -> Result<Vec<Word>, String> {
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
        /* the one picture, read by each language's recogniser */
        let mut passes = vec![];
        for lang in langs {
            let language = Language::CreateLanguage(&HSTRING::from(lang.as_str())).map_err(e)?;
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
            passes.push((lang.clone(), words));
        }
        Ok(super::merge(passes))
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

/// The words on a picture (RGBA, w x h), in the language `lang` (or the
/// languages, with commas between: see `merge`).
pub fn read(px: Vec<u8>, w: u32, h: u32, lang: &str) -> Result<Vec<Word>, String> {
    check_size(px.len(), w, h)?;
    let langs = languages(lang)?;
    #[cfg(windows)]
    {
        win::read(px, w, h, &langs)
    }
    #[cfg(not(windows))]
    {
        let _ = langs;
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

    fn word(text: &str, x: f32, line: u32) -> Word {
        Word { text: text.into(), x, y: 10.0, w: 40.0, h: 12.0, line }
    }

    #[test]
    fn languages_are_one_tag_or_several() {
        assert_eq!(languages("en-US").unwrap(), vec!["en-US"]);
        assert_eq!(languages("en-US,ar-SA").unwrap(), vec!["en-US", "ar-SA"]);
        assert!(languages("").is_err());
        assert!(languages("en-US,").is_err());
        assert!(languages("en US").is_err());
        assert!(languages("a,b,c,d").is_err());
    }

    /// A line "Invoice فاتورة 2026": the English reader reads the Arabic as
    /// Latin nonsense, the Arabic one reads the English badly; each word is
    /// taken from the reader of its letters, the number from either.
    #[test]
    fn two_languages_each_word_from_its_reader() {
        let en = vec![word("Invoice", 0.0, 0), word("6j9L", 50.0, 0), word("2026", 100.0, 0)];
        let ar = vec![word("lnvo1ce", 0.0, 0), word("فاتورة", 50.0, 0), word("2026", 100.0, 0)];
        let got = merge(vec![("en-US".into(), en), ("ar-SA".into(), ar)]);
        let mut texts: Vec<_> = got.iter().map(|w| (w.x as i32, w.text.as_str())).collect();
        texts.sort();
        assert_eq!(texts, vec![(0, "Invoice"), (50, "فاتورة"), (100, "2026")]);
    }

    /// A word only one reader found is kept; one language alone is as read.
    #[test]
    fn a_word_one_reader_missed_is_kept() {
        let en = vec![word("Total", 0.0, 0)];
        let ar = vec![word("المجموع", 200.0, 0), word("15", 300.0, 1)];
        let got = merge(vec![("en-US".into(), en.clone()), ("ar-SA".into(), ar)]);
        let texts: Vec<_> = got.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts.len(), 3);
        assert!(texts.contains(&"Total") && texts.contains(&"المجموع") && texts.contains(&"15"));
        assert_eq!(merge(vec![("en-US".into(), en.clone())]), en);
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
