
::"C:\Program Files (x86)\Plex\Plex Media Server\Plex SQLite.exe"  -init c:\temp\test.sql  "C:\Users\chris\AppData\Local\Plex Media Server\Plug-in Support\Databases\com.plexapp.plugins.library.db" .quit > result

"C:\Program Files (x86)\Plex\Plex Media Server\Plex Media Server.exe"   --sqlite   -init c:\temp\test.sql  "C:\Users\chris\AppData\Local\Plex Media Server\Plug-in Support\Databases\com.plexapp.plugins.library.db" .quit 
::"C:\Program Files (x86)\Plex\Plex Media Server\Plex Media Server.exe"   --sqlite --help


::"C:\Program Files (x86)\Plex\Plex Media Server\Plex SQLite.exe" -help