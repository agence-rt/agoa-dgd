; Personnalisation de l'assistant d'installation AGOA DGD.
; (Les mises à jour automatiques, lancées avec --updated, restent silencieuses.)

; Page d'accueil qui annonce les étapes, dont le choix du dossier d'installation.
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Installation d'AGOA DGD"
  !define MUI_WELCOMEPAGE_TEXT "Cet assistant va installer AGOA DGD, suivi financier des chantiers et décompte général.$\r$\n$\r$\nÉtapes :$\r$\n  1. Pour qui installer (vous seul ou tous les utilisateurs du poste)$\r$\n  2. Choix du dossier d'installation$\r$\n  3. Installation$\r$\n$\r$\nVotre fichier de données et vos PDF ne sont pas modifiés.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Après le choix du dossier : on vérifie qu'on peut y écrire AVANT de lancer l'installation.
; Ex. « Pour moi seulement » + un dossier dans C:\Program Files => pas de droits d'écriture.
; La page ne s'affiche que si le dossier est protégé ; « Précédent » ramène au choix du dossier.
!macro customPageAfterChangeDir
  Var agoaDirLabel
  Page custom agoaDirCheckPre agoaDirCheckLeave
  ; $0 = "1" si le dossier final ($INSTDIR\<appli>) est accessible en écriture.
  Function agoaDirWritable
    Push $1
    Push $2
    StrCpy $2 $INSTDIR
    ${StrContains} $1 "${APP_FILENAME}" $2
    ${If} $1 == ""
      StrCpy $2 "$2\${APP_FILENAME}"
    ${EndIf}
    ClearErrors
    CreateDirectory $2
    StrCpy $0 "0"
    ClearErrors
    FileOpen $1 "$2\.agoa-dgd-test" w
    ${IfNot} ${Errors}
    ${AndIf} $1 != ""
      FileClose $1
      Delete "$2\.agoa-dgd-test"
      StrCpy $0 "1"
    ${EndIf}
    Pop $2
    Pop $1
  FunctionEnd

  Function agoaDirCheckPre
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    Call agoaDirWritable
    ${If} $0 == "1"
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Dossier protégé" "AGOA DGD ne peut pas écrire dans le dossier choisi."
    nsDialogs::Create 1018
    Pop $1
    ${NSD_CreateLabel} 0u 0u 300u 120u "Le dossier suivant est protégé par Windows :$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\nVous avez choisi d'installer pour vous seul, sans droits administrateur. Cliquez sur « Précédent » puis :$\r$\n$\r$\n  • choisissez un autre dossier (par exemple le dossier proposé par défaut, dans votre profil),$\r$\n  • ou revenez à l'étape précédente et choisissez « Pour tous les utilisateurs » (Windows demandera l'autorisation administrateur)."
    Pop $agoaDirLabel
    GetDlgItem $1 $HWNDPARENT 1
    EnableWindow $1 0
    nsDialogs::Show
  FunctionEnd

  Function agoaDirCheckLeave
    Call agoaDirWritable
    ${If} $0 != "1"
      Abort
    ${EndIf}
  FunctionEnd
!macroend
