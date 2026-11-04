; Extra steps for the Windows installer. electron-builder includes this file on its
; own because it sits in the build resources folder.
;
; It adds a page after the install-folder page with a "Create a desktop shortcut"
; checkbox, ticked by default. The shortcut is only made if the box is still ticked,
; and the uninstaller removes it either way. A silent install (/S) skips the page and
; makes no desktop shortcut.

!include nsDialogs.nsh
!include LogicLib.nsh

; The uninstaller is built in a separate pass that never shows this page.
!ifndef BUILD_UNINSTALLER
  Var DesktopShortcutBox
  Var DesktopShortcutState

  Function DesktopShortcutPageShow
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 24u "Choose additional shortcuts to create."
    Pop $0
    ${NSD_CreateCheckbox} 0 30u 100% 12u "Create a desktop shortcut"
    Pop $DesktopShortcutBox
    ${NSD_Check} $DesktopShortcutBox
    nsDialogs::Show
  FunctionEnd

  Function DesktopShortcutPageLeave
    ${NSD_GetState} $DesktopShortcutBox $DesktopShortcutState
  FunctionEnd
!endif

!macro customPageAfterChangeDir
  !ifndef BUILD_UNINSTALLER
    Page custom DesktopShortcutPageShow DesktopShortcutPageLeave
  !endif
!macroend

!macro customInstall
  ${If} $DesktopShortcutState == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
