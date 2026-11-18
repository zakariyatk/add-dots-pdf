; The setup .exe's install (electron-builder.yml, nsis.include): "Combine
; files in Add Dots PDF..." on PDFs picked in Explorer, as Acrobat has it.
; Explorer runs the verb once for each file picked, each with --combine; the
; app is a single instance and gathers them (src/main.js). The same as the
; Tauri app's src-tauri/installer.nsh. Per user, as the install is.

!define ADDDOTS_COMBINE_KEY "Software\Classes\SystemFileAssociations\.pdf\shell\AddDotsCombine"

!macro customInstall
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}" "MUIVerb" "Combine files in Add Dots PDF..."
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "${ADDDOTS_COMBINE_KEY}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --combine "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${ADDDOTS_COMBINE_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
