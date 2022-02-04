//const exiftool = require("exiftool-vendored").exiftool;

const ExifTool = require("exiftool-vendored").ExifTool;
let numCPUs = require("os").cpus().length;
const exiftool = new ExifTool({
    maxProcs: numCPUs
});
const _ = require("lodash");


/**
 * look for XMP tag and return relevant bits
 * @param {string} filename   image filename
 * @returns promise to { modif, faces, pos }
 */
function analyze(filename) {

    return exiftool
        .read(filename)
        .then(tags => {
            //console.log("exif tags ",tags);
            const d = tags.FileModifyDate;
            const modif = new Date(d.year, d.month - 1, d.day, d.hour, d.minute, d.second, 0);

            let pos = null;
            if (tags.GPSLatitude && tags.GPSLongitude)
                pos = {
                    lat: tags.GPSLatitude,
                    lng: tags.GPSLongitude,
                    latlng: `${tags.GPSLatitude},${tags.GPSLongitude}`
                };

            let faces = [];
            if (tags.PersonInImage)
                faces = faces.concat(tags.PersonInImage);

            if (tags.RegionInfo?.RegionList)
                faces = faces.concat(tags.RegionInfo.RegionList.map(elt => elt.Name));

            if (tags.RegionInfoMP?.Regions)
                faces = faces.concat(tags.RegionInfoMP.Regions.map(elt => elt.PersonDisplayName));


            faces = _.uniq(faces);
            faces = _.compact(faces); // remove empty and undefined

            return ({
                modif,
                faces,
                pos,
                //     tags
            });

        });


}

/**
 * retunr raw bits
 * @param {string} filename   image filename
 * @returns promise to exif
 */
function raw(filename) {
    return exiftool.read(filename);
}

/**
 * to be called when finished with analyzing all image files 
 */
function end() {
    exiftool.end();
}


module.exports = {
    analyze,
    raw,
    end
};