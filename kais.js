import fs from 'fs';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));
import downloadFileSync from 'download-file-sync';
import urlencode from 'urlencode';
import { ogr2ogr } from 'ogr2ogr';
import AdmZip from 'adm-zip';

let csrfToken = null;
const DATA_PATH = 'data';
const CACHE_PATH = 'cache';

async function get_csrf_token() {
  const response = await client.get('https://kais.cadastre.bg/bg/OpenData');
  const match = response.data.match(/name="csrf-token"\s+content="([^"]+)"/) ||
                response.data.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  if (!match) throw new Error('Could not find CSRF token');
  csrfToken = match[1];
}

async function kaisRead(path) {
  const url = 'https://kais.cadastre.bg/bg/OpenData/Read';
  var cache_path = `${CACHE_PATH}/`;
  if (path) {
    cache_path += path;
  }
  fs.mkdir(cache_path, { recursive: true }, () => {});
  cache_path += '/read.json';
  try {
    cache = fs.readFileSync(cache_path);
    if (cache) {
      return JSON.parse(cache);
    }
  } catch(e) {
  }
  try {
    var bodyFormData = new FormData();
    if (path) {
      bodyFormData.append("target", path);
    }
    const response = await client.post(url, path?bodyFormData:null, {
      headers: {
        'X-CSRF-TOKEN': csrfToken,
      }
    });
    for (var k in response.data) {
      delete response.data[k].Extension;
      delete response.data[k].IsDirectory;
      delete response.data[k].HasDirectories;
      delete response.data[k].Created;
      delete response.data[k].CreatedUtc;
      delete response.data[k].Modified;
      delete response.data[k].ModifiedUtc;
      delete response.data[k].Size;
    }
    fs.writeFileSync(cache_path, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(error);
  }
};

async function list() {
  await get_csrf_token();
  var OBL = await kaisRead();
  for (var k in OBL) {
    var m = OBL[k].Name;
    console.log(`= ${m}`);
    OBL[k].data = await kaisRead(m);
    for (var k2 in OBL[k].data) {
      var m2 = OBL[k].data[k2].Name;
      console.log(`== ${m2}`);
      OBL[k].data[k2].data = await kaisRead(`${m}/${m2}`);
      for (var k3 in OBL[k].data[k2].data) {
        var m3 = OBL[k].data[k2].data[k3].Name;
        console.log(`=== ${m3}`);
        OBL[k].data[k2].data[k3].data = await kaisRead(`${m}/${m2}/${m3}`);
      }
    }
  }
  fs.writeFileSync(`${CACHE_PATH}/list.json`, JSON.stringify(OBL, null, 2));
}

async function download() {
  if (!fs.existsSync(`${CACHE_PATH}/list.json`)) {
    console.error('list.json not found — run `node scraper.js list` first');
    process.exit(1);
  }
  await get_csrf_token();
  var OBL = JSON.parse(fs.readFileSync(`${CACHE_PATH}/list.json`));
  for (var i1 = 0; i1 < OBL.length; i1++) {
    for (var i2 = 0; i2 < OBL[i1].data.length; i2++) {
      for (var i3 = 0; i3 < OBL[i1].data[i2].data.length; i3++) {
        for (var i4 = 0; i4 < OBL[i1].data[i2].data[i3].data.length; i4++) {
          var path = OBL[i1].data[i2].data[i3].Path;
          var name = OBL[i1].data[i2].data[i3].data[i4].Name;
          var url = "https://kais.cadastre.bg/bg/OpenData/Download?path=" + urlencode(OBL[i1].data[i2].data[i3].data[i4].Path);
          var outDir = `${DATA_PATH}/${path}`;
          var cacheDir = `${CACHE_PATH}/${path}`;
          var doneMarker = `${cacheDir}/${name}.done`;
          fs.mkdirSync(outDir, { recursive: true });
          fs.mkdirSync(cacheDir, { recursive: true });
          if (!fs.existsSync(doneMarker)) {
            console.log(`Downloading ${outDir}`);
            const response = await client.get(url, { responseType: 'arraybuffer' });
            const zip = new AdmZip(Buffer.from(response.data));
            zip.extractAllTo(outDir, true);
            fs.writeFileSync(doneMarker, '');
          }
        }
      }
    }
  }
}

async function shp2json(dir = 'data') {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = `${dir}/${entry}`;
    if (fs.statSync(fullPath).isDirectory()) {
      await shp2json(fullPath);
    } else if (entry.endsWith('.shp')) {
      const outPath = fullPath.replace(/\.shp$/, '.geojson');
      if (!fs.existsSync(outPath)) {
        console.log(`Converting ${fullPath}`);
        await ogr2ogr(fullPath, { format: 'GeoJSON', options: ['-t_srs', 'EPSG:32635'], destination: outPath });
      }
    }
  }
}

function flatten_geojson(path) {
  fs.readdir(path, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return;
    }
    files.forEach(file => {
      const filePath = path + '/' + file;
      var stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        flatten_geojson(filePath);
      }
      if (file.endsWith('.geojson')) {
        var p = file.split(' - ');
        var o = p[0].replace('община', 'o').replaceAll(' ','_');
        var n = p[1].replace('с.','').replace('гр.','').replace(/ \(.....\)/i, '').replaceAll(' ','_');
        var t = p[2].replace('.geojson','').replace('поземлени ', '').replace('самостоятелни обекти', 'СОС').replaceAll(' ','_');
        
        var dstPath = `${path}/${o}__${n}__${t}.geojson`;
        console.log(`[${filePath}] ====> [${dstPath}]`);
        fs.renameSync(filePath, dstPath);
        //fs.copyFileSync(filePath, dstPath);
        }
      });
  });
}

// ---------------------------------

const commands = {
  list:            { fn: () => list(),               desc: 'Crawl folder structure and save to list.json' },
  download:        { fn: () => download(),           desc: 'Download and extract zip files from list.json' },
  shp2json:        { fn: () => shp2json(DATA_PATH),  desc: 'Convert .shp files in data/ to GeoJSON (EPSG:32635)' },
  flatten_geojson: { fn: () => flatten_geojson(DATA_PATH), desc: 'Rename geojson files in current directory' },
};

const cmd = process.argv[2];
if (commands[cmd]) {
  commands[cmd].fn();
} else {
  console.log('Usage: node scraper.js <command>\nCommands:');
  for (const [name, { desc }] of Object.entries(commands))
    console.log(`  ${name.padEnd(16)} ${desc}`);
}
