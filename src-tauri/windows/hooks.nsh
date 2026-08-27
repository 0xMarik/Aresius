!macro NSIS_HOOK_POSTINSTALL
  ; Set DefaultIcon for .ares associations to the Aresius file icon (standalone .ico or PE icon index 1)
  ${If} ${FileExists} "$INSTDIR\resources\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\ares\DefaultIcon" "" "$INSTDIR\resources\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Ares File\DefaultIcon" "" "$INSTDIR\resources\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Ares File Project\DefaultIcon" "" "$INSTDIR\resources\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\resources\icons\file-icon\icon.ico"
  ${ElseIf} ${FileExists} "$INSTDIR\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\ares\DefaultIcon" "" "$INSTDIR\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Ares File\DefaultIcon" "" "$INSTDIR\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Ares File Project\DefaultIcon" "" "$INSTDIR\icons\file-icon\icon.ico"
    WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\icons\file-icon\icon.ico"
  ${Else}
    WriteRegStr SHCTX "Software\Classes\ares\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,1"
    WriteRegStr SHCTX "Software\Classes\Ares File\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,1"
    WriteRegStr SHCTX "Software\Classes\Ares File Project\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,1"
    WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,1"
  ${EndIf}

  ; Notify Windows Shell that file association and icon cache changed
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
