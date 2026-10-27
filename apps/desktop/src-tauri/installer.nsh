; The setup .exe's install (tauri.conf.json, bundle.windows.nsis.installerHooks):
; "Combine files in Add Dots PDF..." on PDFs picked in Explorer, as Acrobat
; has it. Explorer runs the verb once for each file picked (its default
; multi-select model, up to 15 files), each with --combine; the app is a
; single instance and gathers them (src-tauri/src/lib.rs). The Store package
; declares the same verb in msix/AppxManifest.xml. Per user, as the install is.

!define ADDDOTS_COMBINE_KEY "Software\Classes\SystemFileAssociations\.pdf\shell\AddDotsCombine"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}" "MUIVerb" "Combine files in Add Dots PDF..."
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --combine "%1"'
  ; Explorer reads it again
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "${ADDDOTS_COMBINE_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
