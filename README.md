# plex-tags
[Plex](http://plex.tv) is an amazing software to organize, stream, and share your personal multimedia collections, including photos.

`Plex` however lacks two capabilities:

* Add Faces tags from EXIF in photos, which can be automatically recognised by software like [Tag That Photo](http://tagthatphoto.com).
* Add country, city, district names of the location where your photos were taken.

This package allows you to scan your `Plex` photo database, so as to extract the FACE tags and the GPS location. 

&nbsp;

* * *
## Warning - Achtung - Alarm - Attention 
**The various scripts interact directly with Plex database.** 

Make sure you have done a [backup of your database](https://support.plex.tv/articles/201539237-backing-up-plex-media-server-data/)  before using this script.

In case of any issues, [restore your database](https://support.plex.tv/articles/201539237-backing-up-plex-media-server-data/).


&nbsp;

**It is certainly a good idea to stop your Plex server while performing any actions.**

To locate the database file, run `node plex-tools.js -h`. The last line will tell you where the database is.

&nbsp;

* * *
## Installation

1/ it is assumed that node.js >16.0 and npm are already installed.

Install the package as follow:

    npm install plex-tags


&nbsp;
* * *
## Usage

1/ Start by doing a BACKUP of your database. Then double check that your backup is successful.

2/ Register for a free account at [HERE Maps](https://developer.here.com/sign-up) and create a API_KEY.

3/ put this key in a `.env` file, see `env-example` for the format.

4/ Patch your database to add a few useful fields for this tool.

    node plex-tools.js --patch

5/ Scan your database of photo.

    node plex-scan.js --scan

Have a coffee while it's running...
Once finished, if some of the photos do have a GPS location, the script wil indicate:

    XX coords sent for reverse geocoding
    To check status: node plex-geo.js --check 2hToOzrzZmuu9UXyIJUDWBElXIOUTUVH

Wait a few seconds/minutes and run the command that was indicated

    node plex-geo.js --check 2hToOzrzZmuu9UXyIJUDWBElXIOUTUVH

If the database has tens of thousands of photo, you may have to repeat step 5.


6/ Go to Plex and enjoy your photos !


&nbsp;
* * *
## A few options

you may list faces, places, etc using `plex-tools.js`

See all options by running:

    node plex-tools.js --help


&nbsp;
## Missing thumbnails
sometimes, thumbnails are missing for some photos.

run the following command to regenerate them:

    node plex-thumb.js




&nbsp;
* * *
&copy; 2022 devbab