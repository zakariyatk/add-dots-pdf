//! Updates from the Microsoft Store, asked of the Store itself
//! (Windows.Services.Store), for js/update.js.
//!
//! The website's latest build says nothing about the Store: a build reaches
//! the Store only when its MSIX is submitted in Partner Center and passes
//! certification. Comparing with the website offered updates the Store did
//! not have yet, and its page then showed nothing to install. So the Store
//! install asks the Store whether it has a newer package of this app, and
//! installs it from the app (Windows shows its own dialog, closes the app,
//! updates it and the reader starts it again).
//!
//! The setup .exe is not a Store install (no package identity): `available`
//! says so with `None`, and js/update.js compares with the website as before.

/// How an install asked for went, as js/update.js reads it.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Installed {
    /// installed; Windows restarts the app (or has closed it)
    Completed,
    /// the reader said no in Windows' dialog
    Canceled,
    /// there was nothing to install after all
    Nothing,
    /// the Store could not (no network, low battery, …): try its page
    Failed,
}

#[cfg(windows)]
mod win {
    use super::Installed;
    use windows::core::{AgileReference, Interface};
    use windows::ApplicationModel::Package;
    use windows::Services::Store::{StoreContext, StorePackageUpdateState};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IInitializeWithWindow;

    fn e(err: windows::core::Error) -> String {
        err.message().to_string()
    }

    /// The Store, for this app; none for the setup .exe (no package
    /// identity, so not the Store's).
    fn context() -> Result<Option<StoreContext>, String> {
        if Package::Current().is_err() {
            return Ok(None);
        }
        StoreContext::GetDefault().map(Some).map_err(e)
    }

    /// Whether the Store has newer packages of this app.
    pub fn available() -> Result<Option<bool>, String> {
        let Some(ctx) = context()? else { return Ok(None) };
        let list = ctx.GetAppAndOptionalStorePackageUpdatesAsync().map_err(e)?.join().map_err(e)?;
        Ok(Some(list.Size().map_err(e)? > 0))
    }

    /// Downloads and installs the Store's update. The request starts on the
    /// window's own thread (`on_main`), as the Store's dialog is owned by
    /// the window `hwnd`; this thread waits for it to finish.
    pub fn install(hwnd: isize, on_main: super::OnMain) -> Result<Installed, String> {
        let Some(ctx) = context()? else { return Ok(Installed::Nothing) };
        let list = ctx.GetAppAndOptionalStorePackageUpdatesAsync().map_err(e)?.join().map_err(e)?;
        if list.Size().map_err(e)? == 0 {
            return Ok(Installed::Nothing);
        }
        /* the list is not Send; an agile reference to it is */
        let list = AgileReference::new(&list).map_err(e)?;
        let (tx, rx) = std::sync::mpsc::channel();
        on_main(Box::new(move || {
            let start = || {
                let init: IInitializeWithWindow = ctx.cast()?;
                unsafe { init.Initialize(HWND(hwnd as *mut _)) }?;
                ctx.RequestDownloadAndInstallStorePackageUpdatesAsync(&list.resolve()?)
            };
            let _ = tx.send(start().map_err(e));
        }))?;
        let op = rx.recv().map_err(|_| "the window did not start the install".to_string())??;
        let state = op.join().map_err(e)?.OverallState().map_err(e)?;
        Ok(match state {
            StorePackageUpdateState::Completed => Installed::Completed,
            StorePackageUpdateState::Canceled => Installed::Canceled,
            _ => Installed::Failed,
        })
    }
}

/// Runs a closure on the app's main (window) thread.
pub type OnMain = Box<dyn FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), String> + Send>;

/// Installs the Store's update of this app (see `win::install`).
pub fn install(hwnd: isize, on_main: OnMain) -> Result<Installed, String> {
    #[cfg(windows)]
    {
        win::install(hwnd, on_main)
    }
    #[cfg(not(windows))]
    {
        let _ = (hwnd, on_main);
        Err("the Microsoft Store is on Windows only".into())
    }
}

/// Whether the Store has a newer version of this app: `None` when this is
/// not a Store install (or off Windows).
pub fn available() -> Result<Option<bool>, String> {
    #[cfg(windows)]
    {
        win::available()
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}
