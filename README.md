# Bulk-Edit-for-Photoprism
A chrome extension for modifying Photoprism photo/video metadata - keywords, labels, subject, date, artist and copyright.
# Features
- launch the extension with 1 or more photos/videos selected either from the select page or inside Photoprism's edit
- currently supports keywords, labels, subject, date, artist and copyright
- metadata is displayed in 2 categories, Common includes values that are in all selected, Uncommon includes values included in at least one but not in all
- common values can be added to or deleted from the fields, uncommon values can be deleted
- see the effects of commited changes by using 'Reload with Updated Data'
# Good to know
- only tested with Chrome 121.0.6167.140 and Photoprism 231128-f48ff16ef
- there is a timing sensitivity related with programmed clicks of Photoprism buttons.  The 'aLittleWhile' variable at the top of content-script.js adjusts the delay time after button clicks.  20 msec works fine on my machine but it may depend on your machine speed.  One of the symptoms that this might need adjustment is if, with quite a few photos selected, you attemp to set a common value in one of the fields and on reloading with the same selections ('Reload with Updated Data' button) the value you just tried to make common shows up as uncommon.  The fix is to increase the delay in content-script.js, reload the extension, refresh the Photoprism tab, launch the bulk edit extension again and attempt to set the common value again.  The good thing about Photoprism is that when you refresh it's tab, the selections are maintained.  This can be repeated until the value shows as being common.  Note that as you increase the delay, everything gets slower.
- updating of labels during the commit phase is *very* slow.  'Reload with Updated Data' and 'Close' buttons are disabled until the commit is finished BUT clicking a chrome tab or the Photoprism screen will close the extension.  You don't want to do this!  Wait for the extension buttons to be enabled.
# Installation
- download files to directory of your choice
- edit the urls in manifest.json if necessary.  They are currently set to the default Photoprism value (http://localhost:2342/library/*)
- bring up the extension manger (Extensions icon at top right of chrome or ...->Extensions->Manage Extensions)
- click 'Load unpacked'
- select your installation directory
- click the Extensions icon on chrome
- click 'pin'
