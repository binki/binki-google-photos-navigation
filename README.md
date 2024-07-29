## Background

Google Photos allows the user to enter a custom text description for a photo. This feature is useful when sharing photos as it lets you provide an explanation of the photo to the viewer. Additionally, Google Photo’s Search feature will match keywords in the description. So this feature is useful for tagging photos so that they may be found again later.

## Problem

However, the interface for writing descriptions is clumsy and limits productivity. When editing a description, you cannot use the keyboard shortcuts to switch photos because those shortcuts (<kbd>Left</kbd>/<kbd>K</kbd> to navigate to the left, <kbd>Right</kbd>/<kbd>J</kbd> to navigate to the right) are interpreted as edits to the description. Switching to the next photo requires using the mouse to click on arrows or tabbing out of the description textarea. And, when the adjacent photo is displayed, the entire DOM of the editing interface is replaced, so it is not simple to tab back into the description textarea—a large number of tabs or use of the mouse is required.

Reaching for the mouse is the only practical way to navigate between photos while editing descriptions when using the vanilla Google Photos website. But that is very disruptive when performing any keyboard-bound activity, such as typing descriptions. Simply aiming at the description textbox takes a lot of time (I am not an FPS gamer).

## Fix

This userscript adds the following keyboard shortcuts to Google Photos which are only active when editing a photo’s description:

* <kbd>Ctrl</kbd> + <kbd>\[</kbd>: Navigate left.
* <kbd>Ctrl</kbd> + <kbd>\]</kbd>: Navigate right.
* <kbd>Ctrl</kbd> + <kbd>'</kbd>: Launch Add to Album dialog.
* <kbd>Ctrl</kbd> + <kbd>,</kbd>: Edit Location.

[Install](binki-google-photos-navigation.user.js?raw=1)
