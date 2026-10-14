#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/curator.mjs
var import_node_fs = require("node:fs");
var import_node_child_process = require("node:child_process");
var import_node_url = require("node:url");
var import_node_path = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);

// void-app/src/core/env.ts
function createMemoryStorage(opts = {}) {
  const m = new Map(Object.entries(opts.initial || {}));
  return {
    getItem: (k) => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => {
      m.set(k, String(v));
      opts.onWrite && opts.onWrite(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
      opts.onWrite && opts.onWrite(k, null);
    },
    keys: () => [...m.keys()]
  };
}
var SUPABASE_URL_DEFAULT = "https://zsrpsdufwgfyfoulmazt.supabase.co";
var SUPABASE_ANON_KEY_DEFAULT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzcnBzZHVmd2dmeWZvdWxtYXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MTU3ODEsImV4cCI6MjEwMTE5MTc4MX0.TbMvc7Jz_pNTLxW8CVnQvh_ATRwgfnvJnNC_eXFzJO8";
var g = globalThis;
var env = {
  storage: createMemoryStorage(),
  session: createMemoryStorage(),
  fetch: (u, i) => g.fetch(u, i),
  now: () => Date.now(),
  random: () => Math.random(),
  proxyBase: "",
  supabaseUrl: SUPABASE_URL_DEFAULT,
  supabaseAnonKey: SUPABASE_ANON_KEY_DEFAULT,
  oauthRedirect: "thevoid://auth-callback",
  log: () => {
  }
};
var _hooks = [];
function onConfigure(fn) {
  _hooks.push(fn);
}

// void-app/src/core/data/countries.generated.ts
var C = [
  { "n": "Afghanistan", "lat": 33.9, "lon": 67.7, "sr": "afghanistan", "iso": "AF" },
  { "n": "Albania", "lat": 41.2, "lon": 20.2, "sr": "albania", "iso": "AL" },
  { "n": "Algeria", "lat": 28, "lon": 1.7, "sr": "algeria", "iso": "DZ" },
  { "n": "Andorra", "lat": 42.5, "lon": 1.6, "sr": null, "iso": "AD" },
  { "n": "Angola", "lat": -11.2, "lon": 17.9, "sr": "angola", "iso": "AO" },
  { "n": "Antigua and Barbuda", "lat": 17.1, "lon": -61.8, "sr": null, "iso": "AG" },
  { "n": "Argentina", "lat": -38.4, "lon": -63.6, "sr": "argentina", "iso": "AR" },
  { "n": "Armenia", "lat": 40.1, "lon": 45, "sr": "armenia", "iso": "AM" },
  { "n": "Australia", "lat": -25.3, "lon": 133.8, "sr": "australia", "iso": "AU" },
  { "n": "Austria", "lat": 47.5, "lon": 14.6, "sr": "austria", "iso": "AT" },
  { "n": "Azerbaijan", "lat": 40.1, "lon": 47.6, "sr": "azerbaijan", "iso": "AZ" },
  { "n": "Bahamas", "lat": 24.3, "lon": -76, "sr": null, "iso": "BS" },
  { "n": "Bahrain", "lat": 26, "lon": 50.5, "sr": null, "iso": "BH" },
  { "n": "Bangladesh", "lat": 23.7, "lon": 90.4, "sr": "bangladesh", "iso": "BD" },
  { "n": "Barbados", "lat": 13.2, "lon": -59.5, "sr": null, "iso": "BB" },
  { "n": "Belarus", "lat": 53.7, "lon": 28, "sr": "belarus", "iso": "BY" },
  { "n": "Belgium", "lat": 50.5, "lon": 4.5, "sr": "belgium", "iso": "BE" },
  { "n": "Belize", "lat": 17.3, "lon": -88.8, "sr": null, "iso": "BZ" },
  { "n": "Benin", "lat": 9.5, "lon": 2.3, "sr": null, "iso": "BJ" },
  { "n": "Bhutan", "lat": 27.5, "lon": 90.5, "sr": null, "iso": "BT" },
  { "n": "Bolivia", "lat": -16.3, "lon": -63.6, "sr": "bolivia", "iso": "BO" },
  { "n": "Bosnia and Herzegovina", "lat": 44, "lon": 18, "sr": null, "iso": "BA" },
  { "n": "Botswana", "lat": -22, "lon": 24, "sr": null, "iso": "BW" },
  { "n": "Brazil", "lat": -14.2, "lon": -51.9, "sr": "brazil", "iso": "BR" },
  { "n": "Brunei", "lat": 4.5, "lon": 114.7, "sr": null, "iso": "BN" },
  { "n": "Bulgaria", "lat": 42.7, "lon": 25.5, "sr": "bulgaria", "iso": "BG" },
  { "n": "Burkina Faso", "lat": 13, "lon": -2, "sr": null, "iso": "BF" },
  { "n": "Burundi", "lat": -3.5, "lon": 30, "sr": null, "iso": "BI" },
  { "n": "Cambodia", "lat": 12.6, "lon": 105, "sr": "cambodia", "iso": "KH" },
  { "n": "Cameroon", "lat": 6, "lon": 12, "sr": null, "iso": "CM" },
  { "n": "Canada", "lat": 56.1, "lon": -106.4, "sr": "canada", "iso": "CA" },
  { "n": "Cape Verde", "lat": 16, "lon": -24, "sr": null, "iso": "CV" },
  { "n": "Central African Republic", "lat": 7, "lon": 21, "sr": null, "iso": "CF" },
  { "n": "Chad", "lat": 15, "lon": 19, "sr": null, "iso": "TD" },
  { "n": "Chile", "lat": -35.7, "lon": -71.5, "sr": "chile", "iso": "CL" },
  { "n": "China", "lat": 35.9, "lon": 104.2, "sr": "china", "iso": "CN" },
  { "n": "Colombia", "lat": 4.6, "lon": -74.3, "sr": "colombia", "iso": "CO" },
  { "n": "Comoros", "lat": -12.2, "lon": 44.3, "sr": null, "iso": "KM" },
  { "n": "Congo", "lat": -1, "lon": 15, "sr": null, "iso": "CG" },
  { "n": "Costa Rica", "lat": 10, "lon": -84, "sr": null, "iso": "CR" },
  { "n": "Cote d'Ivoire", "lat": 8, "lon": -5, "sr": null, "iso": "CI" },
  { "n": "Croatia", "lat": 45.2, "lon": 15.5, "sr": null, "iso": "HR" },
  { "n": "Cuba", "lat": 21.5, "lon": -79.5, "sr": "cuba", "iso": "CU" },
  { "n": "Cyprus", "lat": 35, "lon": 33, "sr": null, "iso": "CY" },
  { "n": "Czechia", "lat": 49.8, "lon": 15.5, "sr": null, "iso": "CZ" },
  { "n": "Denmark", "lat": 56, "lon": 10, "sr": null, "iso": "DK" },
  { "n": "Djibouti", "lat": 11.5, "lon": 43, "sr": null, "iso": "DJ" },
  { "n": "Dominica", "lat": 15.4, "lon": -61.3, "sr": null, "iso": "DM" },
  { "n": "Dominican Republic", "lat": 19, "lon": -70.7, "sr": null, "iso": "DO" },
  { "n": "DR Congo", "lat": -2.9, "lon": 23.7, "sr": null, "iso": "CD" },
  { "n": "Ecuador", "lat": -1.8, "lon": -78.2, "sr": null, "iso": "EC" },
  { "n": "Egypt", "lat": 26.8, "lon": 30.8, "sr": "egypt", "iso": "EG" },
  { "n": "El Salvador", "lat": 13.8, "lon": -88.9, "sr": null, "iso": "SV" },
  { "n": "Equatorial Guinea", "lat": 2, "lon": 10, "sr": null, "iso": "GQ" },
  { "n": "Eritrea", "lat": 15, "lon": 39, "sr": null, "iso": "ER" },
  { "n": "Estonia", "lat": 59, "lon": 26, "sr": null, "iso": "EE" },
  { "n": "Eswatini", "lat": -26.5, "lon": 31.5, "sr": null, "iso": "SZ" },
  { "n": "Ethiopia", "lat": 9.1, "lon": 40.5, "sr": "ethiopia", "iso": "ET" },
  { "n": "Fiji", "lat": -18, "lon": 175, "sr": null, "iso": "FJ" },
  { "n": "Finland", "lat": 64, "lon": 26, "sr": null, "iso": "FI" },
  { "n": "France", "lat": 46.2, "lon": 2.2, "sr": "france", "iso": "FR" },
  { "n": "Gabon", "lat": -1, "lon": 11.8, "sr": null, "iso": "GA" },
  { "n": "Gambia", "lat": 13.5, "lon": -16.6, "sr": null, "iso": "GM" },
  { "n": "Georgia", "lat": 42, "lon": 43.5, "sr": null, "iso": "GE" },
  { "n": "Germany", "lat": 51.2, "lon": 10.5, "sr": "germany", "iso": "DE" },
  { "n": "Ghana", "lat": 8, "lon": -1, "sr": "ghana", "iso": "GH" },
  { "n": "Greece", "lat": 39.1, "lon": 21.8, "sr": "greece", "iso": "GR" },
  { "n": "Greenland", "lat": 72, "lon": -40, "sr": null, "iso": "GL" },
  { "n": "Grenada", "lat": 12.1, "lon": -61.7, "sr": null, "iso": "GD" },
  { "n": "Guatemala", "lat": 15.5, "lon": -90.3, "sr": null, "iso": "GT" },
  { "n": "Guinea", "lat": 11, "lon": -10, "sr": null, "iso": "GN" },
  { "n": "Guinea-Bissau", "lat": 12, "lon": -15, "sr": null, "iso": "GW" },
  { "n": "Guyana", "lat": 5, "lon": -59, "sr": null, "iso": "GY" },
  { "n": "Haiti", "lat": 19, "lon": -72.3, "sr": "haiti", "iso": "HT" },
  { "n": "Honduras", "lat": 15, "lon": -86.5, "sr": null, "iso": "HN" },
  { "n": "Hong Kong", "lat": 22.3, "lon": 114.2, "sr": null, "iso": "HK" },
  { "n": "Hungary", "lat": 47, "lon": 20, "sr": null, "iso": "HU" },
  { "n": "Iceland", "lat": 65, "lon": -18, "sr": null, "iso": "IS" },
  { "n": "India", "lat": 20.6, "lon": 79, "sr": "india", "iso": "IN" },
  { "n": "Indonesia", "lat": -0.8, "lon": 113.9, "sr": "indonesia", "iso": "ID" },
  { "n": "Iran", "lat": 32.4, "lon": 53.7, "sr": "iran", "iso": "IR" },
  { "n": "Iraq", "lat": 33.2, "lon": 43.7, "sr": "iraq", "iso": "IQ" },
  { "n": "Ireland", "lat": 53.4, "lon": -8.2, "sr": "ireland", "iso": "IE" },
  { "n": "Israel", "lat": 31.1, "lon": 34.9, "sr": "israel", "iso": "IL" },
  { "n": "Italy", "lat": 41.9, "lon": 12.6, "sr": "italy", "iso": "IT" },
  { "n": "Jamaica", "lat": 18.3, "lon": -77.5, "sr": null, "iso": "JM" },
  { "n": "Japan", "lat": 36.2, "lon": 138.3, "sr": "japan", "iso": "JP" },
  { "n": "Jordan", "lat": 30.6, "lon": 36.2, "sr": "jordan", "iso": "JO" },
  { "n": "Kazakhstan", "lat": 48, "lon": 66.9, "sr": "kazakhstan", "iso": "KZ" },
  { "n": "Kenya", "lat": 0, "lon": 37.9, "sr": "kenya", "iso": "KE" },
  { "n": "Kiribati", "lat": 1.4, "lon": 173, "sr": null, "iso": "KI" },
  { "n": "Kosovo", "lat": 42.6, "lon": 20.9, "sr": null, "iso": "XK" },
  { "n": "Kuwait", "lat": 29.3, "lon": 47.7, "sr": null, "iso": "KW" },
  { "n": "Kyrgyzstan", "lat": 41, "lon": 75, "sr": null, "iso": "KG" },
  { "n": "Laos", "lat": 18, "lon": 105, "sr": null, "iso": "LA" },
  { "n": "Latvia", "lat": 57, "lon": 25, "sr": null, "iso": "LV" },
  { "n": "Lebanon", "lat": 33.9, "lon": 35.9, "sr": "lebanon", "iso": "LB" },
  { "n": "Lesotho", "lat": -29.5, "lon": 28.5, "sr": null, "iso": "LS" },
  { "n": "Liberia", "lat": 6.5, "lon": -9.5, "sr": null, "iso": "LR" },
  { "n": "Libya", "lat": 26.3, "lon": 17.2, "sr": "libya", "iso": "LY" },
  { "n": "Liechtenstein", "lat": 47.2, "lon": 9.5, "sr": null, "iso": "LI" },
  { "n": "Lithuania", "lat": 56, "lon": 24, "sr": null, "iso": "LT" },
  { "n": "Luxembourg", "lat": 49.8, "lon": 6.2, "sr": null, "iso": "LU" },
  { "n": "Madagascar", "lat": -20, "lon": 47, "sr": null, "iso": "MG" },
  { "n": "Malawi", "lat": -13.5, "lon": 34, "sr": null, "iso": "MW" },
  { "n": "Malaysia", "lat": 4.2, "lon": 108, "sr": "malaysia", "iso": "MY" },
  { "n": "Maldives", "lat": 3.3, "lon": 73, "sr": null, "iso": "MV" },
  { "n": "Mali", "lat": 17.6, "lon": -4, "sr": "mali", "iso": "ML" },
  { "n": "Malta", "lat": 35.8, "lon": 14.6, "sr": null, "iso": "MT" },
  { "n": "Marshall Islands", "lat": 9, "lon": 168, "sr": null, "iso": "MH" },
  { "n": "Mauritania", "lat": 20, "lon": -12, "sr": null, "iso": "MR" },
  { "n": "Mauritius", "lat": -20.3, "lon": 57.5, "sr": null, "iso": "MU" },
  { "n": "Mexico", "lat": 23.6, "lon": -102.6, "sr": "mexico", "iso": "MX" },
  { "n": "Micronesia", "lat": 6.9, "lon": 158.3, "sr": null, "iso": "FM" },
  { "n": "Moldova", "lat": 47, "lon": 29, "sr": null, "iso": "MD" },
  { "n": "Monaco", "lat": 43.7, "lon": 7.4, "sr": null, "iso": "MC" },
  { "n": "Mongolia", "lat": 46, "lon": 105, "sr": null, "iso": "MN" },
  { "n": "Montenegro", "lat": 42, "lon": 19, "sr": null, "iso": "ME" },
  { "n": "Morocco", "lat": 31.8, "lon": -7.1, "sr": "morocco", "iso": "MA" },
  { "n": "Mozambique", "lat": -18.3, "lon": 35, "sr": null, "iso": "MZ" },
  { "n": "Myanmar", "lat": 16.9, "lon": 96.2, "sr": "myanmar", "iso": "MM" },
  { "n": "Namibia", "lat": -22, "lon": 17, "sr": null, "iso": "NA" },
  { "n": "Nauru", "lat": -0.5, "lon": 166.9, "sr": null, "iso": "NR" },
  { "n": "Nepal", "lat": 28.4, "lon": 84.1, "sr": "nepal", "iso": "NP" },
  { "n": "Netherlands", "lat": 52.1, "lon": 5.3, "sr": "thenetherlands", "iso": "NL" },
  { "n": "New Zealand", "lat": -40.9, "lon": 174.9, "sr": "newzealand", "iso": "NZ" },
  { "n": "Nicaragua", "lat": 13, "lon": -85, "sr": null, "iso": "NI" },
  { "n": "Niger", "lat": 16, "lon": 8, "sr": null, "iso": "NE" },
  { "n": "Nigeria", "lat": 9.1, "lon": 8.7, "sr": "nigeria", "iso": "NG" },
  { "n": "North Korea", "lat": 40.3, "lon": 127.5, "sr": "northkorea", "iso": "KP" },
  { "n": "North Macedonia", "lat": 41.8, "lon": 22, "sr": null, "iso": "MK" },
  { "n": "Norway", "lat": 60.5, "lon": 8.5, "sr": "norway", "iso": "NO" },
  { "n": "Oman", "lat": 21, "lon": 57, "sr": null, "iso": "OM" },
  { "n": "Pakistan", "lat": 30.4, "lon": 69.4, "sr": "pakistan", "iso": "PK" },
  { "n": "Palau", "lat": 7.5, "lon": 134.5, "sr": null, "iso": "PW" },
  { "n": "Palestine", "lat": 31.9, "lon": 35.2, "sr": null, "iso": "PS" },
  { "n": "Panama", "lat": 9, "lon": -80, "sr": null, "iso": "PA" },
  { "n": "Papua New Guinea", "lat": -6, "lon": 147, "sr": null, "iso": "PG" },
  { "n": "Paraguay", "lat": -23, "lon": -58, "sr": null, "iso": "PY" },
  { "n": "Peru", "lat": -9.2, "lon": -75, "sr": "peru", "iso": "PE" },
  { "n": "Philippines", "lat": 12.9, "lon": 121.8, "sr": "philippines", "iso": "PH" },
  { "n": "Poland", "lat": 51.9, "lon": 19.1, "sr": "poland", "iso": "PL" },
  { "n": "Portugal", "lat": 39.4, "lon": -8.2, "sr": "portugal", "iso": "PT" },
  { "n": "Puerto Rico", "lat": 18.3, "lon": -66.5, "sr": null, "iso": "PR" },
  { "n": "Qatar", "lat": 25.5, "lon": 51.3, "sr": null, "iso": "QA" },
  { "n": "Romania", "lat": 45.9, "lon": 25, "sr": "romania", "iso": "RO" },
  { "n": "Russia", "lat": 61.5, "lon": 105.3, "sr": "russia", "iso": "RU" },
  { "n": "Rwanda", "lat": -2, "lon": 30, "sr": null, "iso": "RW" },
  { "n": "Saint Kitts and Nevis", "lat": 17.3, "lon": -62.8, "sr": null, "iso": "KN" },
  { "n": "Saint Lucia", "lat": 13.9, "lon": -61.1, "sr": null, "iso": "LC" },
  { "n": "Saint Vincent and the Grenadines", "lat": 13.3, "lon": -61.2, "sr": null, "iso": "VC" },
  { "n": "Samoa", "lat": -13.6, "lon": -172.3, "sr": null, "iso": "WS" },
  { "n": "San Marino", "lat": 43.8, "lon": 12.4, "sr": null, "iso": "SM" },
  { "n": "Sao Tome and Principe", "lat": 1, "lon": 7, "sr": null, "iso": "ST" },
  { "n": "Saudi Arabia", "lat": 23.9, "lon": 45.1, "sr": "saudiarabia", "iso": "SA" },
  { "n": "Senegal", "lat": 14, "lon": -14, "sr": null, "iso": "SN" },
  { "n": "Serbia", "lat": 44, "lon": 21, "sr": "serbia", "iso": "RS" },
  { "n": "Seychelles", "lat": -4.6, "lon": 55.7, "sr": null, "iso": "SC" },
  { "n": "Sierra Leone", "lat": 8.5, "lon": -11.5, "sr": null, "iso": "SL" },
  { "n": "Singapore", "lat": 1.4, "lon": 103.8, "sr": null, "iso": "SG" },
  { "n": "Slovakia", "lat": 48.7, "lon": 19.5, "sr": null, "iso": "SK" },
  { "n": "Slovenia", "lat": 46, "lon": 15, "sr": null, "iso": "SI" },
  { "n": "Solomon Islands", "lat": -8, "lon": 159, "sr": null, "iso": "SB" },
  { "n": "Somalia", "lat": 5.2, "lon": 46.2, "sr": "somalia", "iso": "SO" },
  { "n": "South Africa", "lat": -30.6, "lon": 22.9, "sr": "southafrica", "iso": "ZA" },
  { "n": "South Korea", "lat": 35.9, "lon": 127.8, "sr": "korea", "iso": "KR" },
  { "n": "South Sudan", "lat": 7.9, "lon": 29.7, "sr": null, "iso": "SS" },
  { "n": "Spain", "lat": 40.5, "lon": -3.7, "sr": "spain", "iso": "ES" },
  { "n": "Sri Lanka", "lat": 7, "lon": 81, "sr": null, "iso": "LK" },
  { "n": "Sudan", "lat": 12.9, "lon": 30.2, "sr": "sudan", "iso": "SD" },
  { "n": "Suriname", "lat": 4, "lon": -56, "sr": null, "iso": "SR" },
  { "n": "Sweden", "lat": 60.1, "lon": 18.6, "sr": "sweden", "iso": "SE" },
  { "n": "Switzerland", "lat": 47, "lon": 8, "sr": null, "iso": "CH" },
  { "n": "Syria", "lat": 34.8, "lon": 39, "sr": "syria", "iso": "SY" },
  { "n": "Taiwan", "lat": 23.7, "lon": 121, "sr": "taiwan", "iso": "TW" },
  { "n": "Tajikistan", "lat": 39, "lon": 71, "sr": null, "iso": "TJ" },
  { "n": "Tanzania", "lat": -6, "lon": 35, "sr": null, "iso": "TZ" },
  { "n": "Thailand", "lat": 15.9, "lon": 101, "sr": "thailand", "iso": "TH" },
  { "n": "Timor-Leste", "lat": -8.6, "lon": 125.5, "sr": null, "iso": "TL" },
  { "n": "Togo", "lat": 8, "lon": 1.2, "sr": null, "iso": "TG" },
  { "n": "Tonga", "lat": -20, "lon": -175, "sr": null, "iso": "TO" },
  { "n": "Trinidad and Tobago", "lat": 11, "lon": -61, "sr": null, "iso": "TT" },
  { "n": "Tunisia", "lat": 33.9, "lon": 9.5, "sr": "tunisia", "iso": "TN" },
  { "n": "Turkey", "lat": 39, "lon": 35.2, "sr": "turkey", "iso": "TR" },
  { "n": "Turkmenistan", "lat": 40, "lon": 60, "sr": null, "iso": "TM" },
  { "n": "Tuvalu", "lat": -8, "lon": 178, "sr": null, "iso": "TV" },
  { "n": "Uganda", "lat": 1.4, "lon": 32.3, "sr": "uganda", "iso": "UG" },
  { "n": "Ukraine", "lat": 48.4, "lon": 31.2, "sr": "ukraine", "iso": "UA" },
  { "n": "United Arab Emirates", "lat": 23.4, "lon": 53.8, "sr": "dubai", "iso": "AE" },
  { "n": "United Kingdom", "lat": 55.4, "lon": -3.4, "sr": "unitedkingdom", "iso": "GB" },
  { "n": "United States", "lat": 37.1, "lon": -95.7, "sr": "news", "iso": "US" },
  { "n": "Uruguay", "lat": -33, "lon": -56, "sr": null, "iso": "UY" },
  { "n": "Uzbekistan", "lat": 41, "lon": 64, "sr": null, "iso": "UZ" },
  { "n": "Vanuatu", "lat": -16, "lon": 167, "sr": null, "iso": "VU" },
  { "n": "Venezuela", "lat": 6.4, "lon": -66.6, "sr": "vzla", "iso": "VE" },
  { "n": "Vietnam", "lat": 14.1, "lon": 108.3, "sr": "vietnam", "iso": "VN" },
  { "n": "Yemen", "lat": 15.6, "lon": 48.5, "sr": "yemen", "iso": "YE" },
  { "n": "Zambia", "lat": -15, "lon": 30, "sr": null, "iso": "ZM" },
  { "n": "Zimbabwe", "lat": -19, "lon": 29.2, "sr": "zimbabwe", "iso": "ZW" }
];

// void-app/src/core/data/regionAliases.generated.ts
var REGION_ALIASES = {
  "usa": "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states of america": "US",
  "america": "US",
  "uk": "GB",
  "u.k.": "GB",
  "britain": "GB",
  "great britain": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "northern ireland": "GB",
  "russian federation": "RU",
  "ussr": "RU",
  "south korea": "KR",
  "republic of korea": "KR",
  "korea south": "KR",
  "north korea": "KP",
  "dprk": "KP",
  "korea north": "KP",
  "dr congo": "CD",
  "drc": "CD",
  "democratic republic of the congo": "CD",
  "congo kinshasa": "CD",
  "congo": "CG",
  "republic of the congo": "CG",
  "congo brazzaville": "CG",
  "ivory coast": "CI",
  "cote d ivoire": "CI",
  "burma": "MM",
  "myanmar burma": "MM",
  "czech republic": "CZ",
  "czechia": "CZ",
  "holland": "NL",
  "netherlands the": "NL",
  "uae": "AE",
  "united arab emirates": "AE",
  "saudi": "SA",
  "ksa": "SA",
  "turkiye": "TR",
  "turkey": "TR",
  "vatican": "VA",
  "holy see": "VA",
  "cape verde": "CV",
  "swaziland": "SZ",
  "macedonia": "MK",
  "north macedonia": "MK",
  "east timor": "TL",
  "timor leste": "TL",
  "ivory  coast": "CI",
  "palestine": {
    "code": "PS",
    "custom": true,
    "lat": 31.9,
    "lon": 35.2
  },
  "palestinian territories": {
    "code": "PS",
    "custom": true,
    "lat": 31.9,
    "lon": 35.2
  },
  "palestinian territory": {
    "code": "PS",
    "custom": true,
    "lat": 31.9,
    "lon": 35.2
  },
  "state of palestine": {
    "code": "PS",
    "custom": true,
    "lat": 31.9,
    "lon": 35.2
  },
  "gaza": {
    "code": "PS-GZA",
    "parent": "PS",
    "custom": true,
    "lat": 31.5,
    "lon": 34.47
  },
  "gaza strip": {
    "code": "PS-GZA",
    "parent": "PS",
    "custom": true,
    "lat": 31.5,
    "lon": 34.47
  },
  "west bank": {
    "code": "PS-WBK",
    "parent": "PS",
    "custom": true,
    "lat": 31.95,
    "lon": 35.3
  },
  "kosovo": {
    "code": "XK",
    "custom": true,
    "lat": 42.6,
    "lon": 20.9
  },
  "western sahara": {
    "code": "EH",
    "custom": true,
    "lat": 24.2,
    "lon": -12.9
  },
  "taiwan": {
    "code": "TW",
    "custom": true
  },
  "crimea": {
    "code": "UA-43",
    "parent": "UA",
    "custom": true,
    "lat": 45.3,
    "lon": 34.4
  },
  "donetsk": {
    "code": "UA-14",
    "parent": "UA",
    "custom": true,
    "lat": 48,
    "lon": 37.8
  },
  "nagorno karabakh": {
    "code": "AZ-NK",
    "parent": "AZ",
    "custom": true,
    "lat": 39.8,
    "lon": 46.75
  },
  "kashmir": {
    "code": "IN-JK",
    "parent": "IN",
    "custom": true,
    "lat": 33.8,
    "lon": 76.6
  },
  "somaliland": {
    "code": "SO-SL",
    "parent": "SO",
    "custom": true,
    "lat": 9.6,
    "lon": 45
  },
  "northern cyprus": {
    "code": "CY-NC",
    "parent": "CY",
    "custom": true,
    "lat": 35.3,
    "lon": 33.4
  },
  "tibet": {
    "code": "CN-XZ",
    "parent": "CN",
    "custom": true,
    "lat": 31.5,
    "lon": 88.9
  },
  "abkhazia": {
    "code": "GE-AB",
    "parent": "GE",
    "custom": true,
    "lat": 43,
    "lon": 41
  }
};

// void-app/src/core/data/regions.ts
var _regionNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
var _REGION_ALIAS_N = (() => {
  const m = {};
  for (const k in REGION_ALIASES) m[_regionNorm(k)] = REGION_ALIASES[k];
  return m;
})();
var _regionByName = (() => {
  const m = {};
  for (const c of C) m[_regionNorm(c.n)] = { code: c.iso, lat: c.lat, lon: c.lon, name: c.n };
  return m;
})();
var _regionByCode = (() => {
  const m = {};
  for (const c of C) m[c.iso] = { code: c.iso, lat: c.lat, lon: c.lon, name: c.n };
  return m;
})();

// void-app/src/core/rank/story.ts
var TENSION_TAGS = /* @__PURE__ */ new Set(["crisis", "graphic", "warfare", "resistance", "power", "deception", "surveillance", "geopolitics"]);
var SPIKE_HALF_LIFE_H = 6;
function hasTension(p) {
  return (p.tags || []).some((t) => TENSION_TAGS.has(t));
}
function postAgeH(p) {
  const now = env.now();
  return Math.max(0, (now - (p.time || now)) / 36e5);
}
function velocity(p) {
  const eng = (p.score || 0) + 2 * (p._reposts || 0) + 3 * (p._quotes || 0) + 2 * (p.replies || 0);
  return eng / Math.pow(Math.max(0.25, postAgeH(p)), 0.8);
}
var _stories = /* @__PURE__ */ new Map();
function storyOf(p) {
  return p && p._story ? _stories.get(p._story) || null : null;
}
function storySources(p) {
  const s = storyOf(p);
  return s ? s.srcs.size : 0;
}
function breakingLift(p) {
  if (p._noBoost) return 0;
  const ageH = postAgeH(p);
  if (ageH > 48) return 0;
  const tense = hasTension(p);
  const v = velocity(p);
  const spike = Math.min(60, Math.max(0, Math.log10(v + 1) - 2) * 25) * (tense ? 1 : 0.4);
  const n = storySources(p);
  const corr = tense && n >= 2 ? Math.min(28, 12 * Math.log2(n)) : 0;
  return (spike + corr) * Math.pow(0.5, ageH / SPIKE_HALF_LIFE_H);
}
function controversyLift(p) {
  const replies = p.replies || 0, quotes = p._quotes || 0;
  if (replies + quotes < 10) return 0;
  const cont = Math.min(1, (replies + quotes * 2) / Math.max(25, (p.score || 0) * 0.15));
  return 22 * cont * (hasTension(p) ? 1 : 0.6);
}

// void-app/src/core/rank/bio.ts
var READABILITY = {
  PUNCHY_MAX: 140,
  PUNCHY_MIN_BONUS: 6,
  PUNCHY_EXTRA: 14,
  LONG_SPAN: 260,
  LONG_PENALTY: 24,
  EARNED_WAIVER: 0.85,
  DENSE_MIN: 200,
  DENSE_SPAN: 300,
  DENSE_PENALTY: 12,
  MEDIA_SCALE: 0.35,
  WIRE_PENALTY: 9
};
function textFit(p) {
  const R = READABILITY;
  const t = String(p.body || "");
  const len = t.length;
  if (!len) return 0;
  const dens = t.split(/\n+/).reduce((m, s2) => Math.max(m, s2.length), 0);
  const e = earned(p);
  let s;
  if (len <= R.PUNCHY_MAX) s = R.PUNCHY_MIN_BONUS + R.PUNCHY_EXTRA * (1 - len / R.PUNCHY_MAX);
  else s = -R.LONG_PENALTY * Math.min(1, (len - R.PUNCHY_MAX) / R.LONG_SPAN) * (1 - R.EARNED_WAIVER * e);
  if (dens > R.DENSE_MIN) s -= R.DENSE_PENALTY * Math.min(1, (dens - R.DENSE_MIN) / R.DENSE_SPAN) * (1 - R.EARNED_WAIVER * e);
  if (p._img || p._video) s *= R.MEDIA_SCALE;
  if (p._wire) s -= R.WIRE_PENALTY;
  return s;
}
function earned(p) {
  const likes = p.score || 0, reposts = p._reposts || 0, quotes = p._quotes || 0, replies = p.replies || 0;
  const eng = Math.min(1, Math.log10(likes + reposts * 2 + 10) / 4);
  const cont = Math.min(1, (replies + quotes * 2) / Math.max(25, likes * 0.15));
  const base = eng * 0.6 + cont * 0.4;
  return Math.max(0, Math.min(1, p._wire ? base * 0.45 : base));
}
var _refreshBoost = null;
var BIO_TAGS = ["theology", "AI", "resistance", "surveillance", "warfare", "power", "philosophy", "geopolitics", "deception", "identity", "graphic", "animals", "nature", "crisis"];
var BIO = {
  tags: Object.fromEntries(BIO_TAGS.map((t) => [t, 0])),
  totalDwell: 0,
  totalViewed: 0,
  score: 0,
  sessions: {},
  regions: {},
  formats: {},
  dirty: false,
  /** Set when learning happened while the profile's interest map was off screen. */
  mapDirty: false,
  affect: null,
  /** Native AffectState hook (web: window.__VOID_AFFECT__). Stored only. */
  setAffect(state) {
    this.affect = state && typeof state === "object" ? state : null;
  },
  recordDwell(id, ms, tags) {
    this.sessions[id] = (this.sessions[id] || 0) + ms;
    this.totalDwell += ms;
    this.totalViewed++;
    const w = Math.min(ms / 2e3, 1.5);
    (tags || []).forEach((t) => {
      if (this.tags[t] !== void 0) this.tags[t] = Math.min(100, this.tags[t] + w * 8);
    });
    this.score = Math.min(100, this.score + w * 3);
    this.dirty = true;
    this.mapDirty = true;
  },
  react(id, type, tags) {
    const w = REACT_W[type] || 5;
    (tags || []).forEach((t) => {
      if (this.tags[t] !== void 0) this.tags[t] = Math.min(100, this.tags[t] + w);
    });
    this.score = Math.min(100, this.score + w / 2);
    this.dirty = true;
    this.mapDirty = true;
  },
  /**
   * Take a reaction back off.
   *
   * Un-hearting used to teach nothing, so a mis-tap was permanent: the weight
   * went on, the reader undid it on screen, and the feed kept leaning that way
   * for the rest of the session. Reactions are the heaviest signal the model
   * takes (a heart is +15 on every tag of the post, against a full dwell's +1.5)
   * so that is not a rounding error.
   *
   * Symmetric with react(), and floored the same way decay() floors: an interest
   * the reader chose outright at Ignite cannot be undone below its floor by
   * un-hearting something that happened to carry the tag.
   */
  unreact(id, type, tags) {
    const w = REACT_W[type] || 5;
    (tags || []).forEach((t) => {
      if (this.tags[t] !== void 0) this.tags[t] = Math.max(this.floors[t] || 0, this.tags[t] - w);
    });
    this.score = Math.max(0, this.score - w / 2);
    this.dirty = true;
    this.mapDirty = true;
  },
  /** Web: every 5s. */
  /** Interests the reader chose outright (Jump In "Ignite"). Learned weight decays
   *  as always; a chosen one never decays below its floor, so an explicit pick
   *  isn't forgotten ~12 minutes into the first session. Empty = web behaviour. */
  floors: {},
  decay() {
    Object.keys(this.tags).forEach((t) => {
      this.tags[t] = Math.max(this.floors[t] || 0, this.tags[t] * 0.995);
    });
  },
  bumpRegion(country, w) {
    if (!country) return;
    this.regions[country] = Math.max(0, Math.min(100, (this.regions[country] || 0) + w));
    this.dirty = true;
  },
  bumpFormat(style, w) {
    if (!style) return;
    this.formats[style] = Math.max(0, Math.min(100, (this.formats[style] || 0) + w));
    this.dirty = true;
  },
  /** Web: idle flush every 15s + pagehide/visibilitychange. */
  save() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      env.storage.setItem("void_bio", JSON.stringify({ tags: this.tags, regions: this.regions, formats: this.formats, score: this.score, floors: this.floors }));
    } catch {
    }
  },
  load() {
    try {
      const d = JSON.parse(env.storage.getItem("void_bio") || "null");
      if (d) {
        Object.assign(this.tags, d.tags || {});
        this.regions = d.regions || {};
        this.formats = d.formats || {};
        this.score = d.score || 0;
        this.floors = d.floors || {};
      }
    } catch {
    }
  },
  /** Interest-map classes for the profile screen (web _update()). */
  interestMap() {
    this.mapDirty = false;
    return Object.entries(this.tags).map(([t, v]) => ({ tag: t, level: v > 50 ? "hot" : v > 20 ? "warm" : "cold" }));
  },
  rankScore(p) {
    const tenseAff = () => Math.max(0, ...[...TENSION_TAGS].filter((t) => t !== "crisis").map((t) => this.tags[t] || 0));
    const tag = (p.tags || []).reduce((s, t) => s + (t === "crisis" ? Math.max(this.tags.crisis || 0, 0.6 * tenseAff()) : this.tags[t] || 0), 0);
    const reg = this.regions[p.country] || 0;
    const fmt = this.formats[p.style] || 0;
    const now = env.now();
    const ageH = Math.max(0, (now - (p.time || now)) / 36e5);
    const fresh = Math.exp(-ageH / 18) * 40;
    const pop = Math.log10((p.score || 0) + 10) * 6;
    const refreshLift = _refreshBoost && _refreshBoost.has(p.id) ? 1e4 : 0;
    return tag * 1 + reg * 0.6 + fmt * 0.4 + fresh + pop + (p._social ? 8 : 0) + textFit(p) + breakingLift(p) + controversyLift(p) + refreshLift;
  },
  /** Test/reset: zero every learned weight. */
  reset() {
    for (const t of BIO_TAGS) this.tags[t] = 0;
    this.regions = {};
    this.formats = {};
    this.floors = {};
    this.score = 0;
    this.totalDwell = 0;
    this.totalViewed = 0;
    this.sessions = {};
    this.dirty = false;
  }
};
BIO.load();
onConfigure(() => {
  BIO.reset();
  BIO.load();
});
var REACT_W = { reply: 20, fire: 15, rank: 10, slash: 5 };

// void-app/src/core/rank/seen.ts
function _h(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function _loadSeen(k) {
  try {
    const a = JSON.parse(env.storage.getItem(k) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
var _seenIds = /* @__PURE__ */ new Set();
var _seenText = /* @__PURE__ */ new Set();
var _seenLink = /* @__PURE__ */ new Set();
var _seenDirty = false;
function loadSeenAll() {
  _seenIds.clear();
  _seenText.clear();
  _seenLink.clear();
  _loadSeen("void_seen_ids").forEach((x) => _seenIds.add(x));
  _loadSeen("void_seen_text").forEach((x) => _seenText.add(x));
  _loadSeen("void_seen_link").forEach((x) => _seenLink.add(x));
  _seenDirty = false;
}
loadSeenAll();
onConfigure(loadSeenAll);
function _normText(t) {
  return String(t || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// void-app/src/core/rank/filters.ts
var VOID_NATIVE = /* @__PURE__ */ new Set();
function loadNative() {
  VOID_NATIVE.clear();
  try {
    JSON.parse(env.storage.getItem("void_native_accounts") || "[]").forEach((h) => VOID_NATIVE.add(h));
  } catch {
  }
}
loadNative();
var MUTED = /* @__PURE__ */ new Set();
var MUTE_RE = () => [...MUTED].map((m) => new RegExp("\\b" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
var _muteRe = [];
function loadMuted() {
  MUTED.clear();
  try {
    JSON.parse(env.storage.getItem("void_muted") || '["trump"]').forEach((m) => MUTED.add(m));
  } catch {
    MUTED.add("trump");
  }
  _muteRe = MUTE_RE();
}
loadMuted();
onConfigure(() => {
  loadMuted();
  loadNative();
});
var NV_CREDIT = new RegExp("(?:^|[\\s(])(?:\u{1F4F8}|\u{1F4F7}|\u{1F3A8})\\s*(?:[:\uFF1A]\\s*)?(?:@\\w|\\p{Lu})|\\b(?:photo|image|picture|painting|artwork)s?\\s+(?:by|courtesy of)\\s+\\p{Lu}|\\bphoto\\s*:\\s*(?:@\\w|\\p{Lu})|\\b(?:photo|image)\\s*credit\\b|\\bwikimedia\\b", "mu");
var NV_BINOMIAL = new RegExp("\\(\\p{Lu}[a-z]+ [a-z]{4,}(?:\\)| ')", "u");
var SLOP_FILLER = /\bin today'?s (?:fast[- ]paced|digital|ever[- ]changing|modern) world\b|\blet'?s dive in\b|\bdelve\b|\btapestry\b|\bgame[- ]?changer\b|\bunlock (?:your|the) (?:full |true )?potential\b|\bembrace the (?:journey|process)\b|\ba testament to\b|\bnavigat\w* the (?:complexit|landscape)\w*|\bit'?s not just (?:a|an|about) [^,.]{1,40}, it'?s\b|\belevate your\b|\bin conclusion\b|\bkey takeaways?\b|\bstay tuned\b|\blevel up your\b/i;
var SLOP_BAIT = /\bfollow (?:me )?for more\b|\blike (?:and|&) (?:share|retweet|repost|follow)\b|\b(?:repost|retweet|rt|share|like) (?:this )?if (?:you|u)\b|\bdrop an? \S+ (?:if|below|in the)\b|\bcomment below\b|\btag (?:someone|a friend)\b|\bwho else\b[^?\n]*\?|^(?:agree|thoughts|am i wrong|right)\s*\?\s*$|\blink in (?:my )?bio\b|\bgiveaway\b|👇/imu;
var SLOP_SPAM = /\b(?:promo|discount|coupon) code\b|\buse (?:my )?code\b|\b\d{2}% off\b|\bbuy now\b|\blimited time offer\b|\bairdrop\b|\bonlyfans\b|\bcheck out my (?:shop|store|page|channel|link)\b|\bpassive income\b|\bdm (?:me )?(?:for|to) (?:collab|promo|price)/i;
var SLOP_HYPE = /#(?:motivation\w*|mindset|hustle\w*|grindset|entrepreneur\w*|quoteoftheday|successmindset)\b|\brise and grind\b|\bnever give up\b|\byou won'?t believe\b|\bnobody is talking about\b|\bthey don'?t want you to know\b|\bwake up,? (?:people|sheeple)\b/i;
var SLOP_HARD = 0.7;
function slopScore(p) {
  const t = String(p.body || "");
  if (!t) return 0;
  let s = 0;
  if (SLOP_FILLER.test(t)) s += 0.45;
  const bait = (t.match(new RegExp(SLOP_BAIT.source, "gimu")) || []).length;
  if (bait) s += 0.25 + 0.25 * bait;
  if (SLOP_SPAM.test(t)) s += 0.7;
  if (SLOP_HYPE.test(t)) s += 0.45;
  const letters = t.replace(/[^\p{L}]/gu, ""), caps = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (letters.length >= 24 && caps / letters.length > 0.6) s += 0.3;
  const emoji = (t.match(new RegExp("\\p{Extended_Pictographic}", "gu")) || []).length;
  if (emoji >= 5 && emoji / t.length > 0.04) s += 0.3;
  if ((t.match(/!/g) || []).length >= 4) s += 0.2;
  return Math.min(1, s);
}
function slopKey(p) {
  return _h(_normText(p.body).slice(0, 280));
}

// void-app/src/core/rank/tags.ts
var TAG_KEYWORDS = {
  // CRISIS leads so it is tags[0] — diversify() buckets on tags[0], which keeps a
  // breaking disaster from stacking consecutive slots. Added after the Nepal /
  // Bhotekoshi glacial flood (Aug-Sep 2026, 1,300+ dead) was invisible to the gate.
  // Only strong terms here; ambiguous ones count only in pairs (CRISIS_WEAK).
  crisis: ["tragedy", "disaster*", "catastroph*", "death toll", "casualt*", "massacre*", "stampede*", "earthquake*", "landslide*", "mudslide*", "avalanche*", "tsunami", "flash flood*", "floods", "flooding", "glacial lake", "glacial flood", "cyclone", "plane crash", "helicopter crash", "bus crash", "train crash", "derail*", "capsiz*", "shipwreck", "building collapse", "bridge collapse", "dam collapse", "curfew", "crackdown", "state of emergency", "martial law", "feared dead", "bodies recovered", "rescuers", "evacuat*", "mass shooting", "gunman", "famine", "cholera"],
  warfare: ["war", "wars", "warfare", "strike", "strikes", "airstrike*", "shelling", "frontline", "front line", "missile*", "drone*", "artillery", "offensive", "combat", "troops", "soldier*", "ceasefire", "invasion", "invaded", "bombard*"],
  graphic: ["killed", "dead", "death toll", "casualt*", "massacre*", "bodies", "wounded", "execution", "executed", "atrocit*", "genocide", "beheaded", "corpse*"],
  geopolitics: ["border", "borders", "sanction*", "treaty", "summit", "nato", "united nations", "embassy", "diplomat*", "election*", "parliament", "annex*"],
  power: ["regime", "coup", "coups", "president", "presidency", "minister", "oligarch*", "corruption", "corrupt", "crackdown", "martial law", "dictator*", "junta"],
  surveillance: ["surveillance", "facial recognition", "spyware", "wiretap*", "privacy", "censorship", "censor*", "mass tracking"],
  resistance: ["protest*", "uprising", "revolt", "demonstrat*", "riot", "riots", "rioting", "dissident*", "resistance", "insurgen*"],
  theology: ["islam*", "christian*", "jewish", "muslim*", "church", "mosque", "synagogue", "sectarian", "religio*", "cleric*", "jihad*", "caliphate"],
  AI: ["ai", "artificial intelligence", "algorithm*", "openai", "chatbot*", "deepfake*", "llm", "machine learning"],
  // The conspiracy register the app is built around: suppressed warnings, blame, cover-ups.
  deception: ["propaganda", "disinformation", "misinformation", "psyop*", "bot network", "cover-up", "cover up", "covered up", "falsified", "forged", "conspirac*", "false flag", "whistleblower*", "leaked", "they knew", "was warned", "were warned", "ignored warnings", "nobody is answering", "no one is answering"],
  identity: ["diaspora", "refugee*", "migrant*", "ethnic", "ethnicity", "minority", "citizenship", "statelessness"],
  philosophy: ["philosoph*", "morality", "existential", "nihilis*", "ideolog*"],
  // Street-level incidents: how a viral current-events clip is captioned ("Tempe Police
  // push, tackle and punch...", "Footage shows..."). None of it matched, so the reel
  // lanes dropped exactly those clips as untagged. Bare shot / shooting / fight / crash
  // are phrases only: "great shot", "shooting on 35mm", "fight for", "crash course".
  // TAG_KEYWORDS gates the main feed too, so no bare footage / officer / cop / viral
  // ("gameplay footage", "chief executive officer", "cop these sneakers", "song went viral").
  incident: [
    "police",
    "policeman",
    "policemen",
    "police officer*",
    "officer-involved",
    "cops",
    "cop car*",
    "bodycam*",
    "body cam*",
    "dashcam*",
    "dash cam*",
    "cctv",
    "caught on camera",
    "caught on video",
    "arrest",
    "arrests",
    "arrested",
    "handcuff*",
    "detain*",
    "taser*",
    "tased",
    "tear gas",
    "teargas",
    "pepper spray*",
    "rubber bullet*",
    "shootings",
    "school shooting",
    "fatal shooting",
    "shooting suspect",
    "shooting victim*",
    "shot dead",
    "shot and killed",
    "was shot",
    "were shot",
    "got shot",
    "gunfire",
    "gunshot*",
    "opened fire",
    "stabbing",
    "stabbed",
    "brawl*",
    "fistfight*",
    "fist fight",
    "fight breaks out",
    "fight broke out",
    "street fight",
    "punched",
    "assault*",
    "car crash",
    "crashed into",
    "crashes into",
    "pileup",
    "pile-up",
    "hit-and-run",
    "hit and run",
    "rammed into",
    "ramming",
    "kidnap*",
    "carjack*",
    "robbery",
    "looting",
    "manhunt",
    "ice agents",
    "federal agents",
    "border patrol"
  ],
  // ---- Everything below exists so the feed has RANGE. The vocabulary above is all
  // conflict and politics, and the tag gate discards anything matching none of it.
  science: ["science", "scientist*", "research", "researcher*", "study finds", "physics", "biolog*", "chemistr*", "neuroscience", "genome", "quantum", "experiment*"],
  space: ["nasa", "spacex", "rocket", "satellite*", "orbit", "mars", "lunar", "asteroid", "telescope", "galaxy", "astronaut*", "spacecraft", "eclipse"],
  tech: ["software", "hardware", "startup*", "silicon valley", "semiconductor*", "robotic*", "robot", "crypto", "blockchain", "open source", "engineer*", "browser", "encryption"],
  climate: ["climate", "wildfire*", "flood*", "flooding", "drought", "hurricane", "typhoon", "earthquake", "emissions", "glacier*", "heatwave", "renewable*"],
  nature: ["forest*", "ocean", "coral", "ecosystem*", "conservation", "rainforest", "extinct*", "climate"],
  // Pets/wildlife as CONTENT, split out of nature so it can be governed on its own.
  animals: ["wildlife", "species", "animal*", "bird*", "birding", "whale*", "cat", "cats", "kitten*", "kitty", "dog", "dogs", "puppy", "pupper", "doggo", "pet", "pets", "hedgehog", "squirrel", "bunny", "rabbit", "hamster", "parrot", "meow", "purr", "caturday", "zoomies", "aquarium", "zoo", "kingfisher"],
  culture: ["museum", "exhibition", "literature", "novel", "poet*", "festival", "heritage", "archive*", "translation", "folklore"],
  art: ["art", "artist*", "painting", "sculpture", "illustration", "photograph*", "architecture", "mural", "gallery", "typograph*"],
  music: ["music", "album", "song", "band", "concert", "guitar", "jazz", "hip hop", "orchestra", "composer", "vinyl"],
  film: ["film", "movie", "cinema", "documentary", "screenplay", "filmmaker*", "trailer", "animation"],
  sport: ["football", "soccer", "basketball", "olympic*", "tournament", "league", "athlete*", "marathon", "cricket", "tennis", "boxing", "formula 1"],
  food: ["recipe", "restaurant", "chef", "cuisine", "coffee", "harvest", "farming", "bakery"],
  history: ["history", "historic*", "archaeolog*", "ancient", "medieval", "empire", "artifact*", "excavation", "manuscript*"],
  health: ["medicine", "vaccine*", "hospital", "disease", "mental health", "virus", "doctor*", "therapy", "outbreak"],
  economy: ["economy", "inflation", "currency", "unemployment", "tariff*", "recession", "housing", "labour", "labor union"],
  games: ["gaming", "video game*", "console", "esports", "nintendo", "playstation", "xbox", "speedrun*"]
};
var TAG_RE = (() => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = {};
  for (const tag in TAG_KEYWORDS) {
    out[tag] = TAG_KEYWORDS[tag].map((k) => k.endsWith("*") ? new RegExp("\\b" + esc(k.slice(0, -1)), "i") : new RegExp("\\b" + esc(k) + "\\b", "i"));
  }
  return out;
})();

// void-app/src/core/feed/bluesky.ts
var BSKY_FEEDS = [
  // Ordered by MEASURED yield against inferTags() (50-60 posts sampled per feed):
  //   aaahy7 24 matched/13 +media · aaagsz 35/9 · aaalrz 24/5 · aaadhh 10/4 · whats-hot 4/3 (39 img, 9 vid)
  // The mainstream news generators (verified-news, news-2-0) are REMOVED: they made
  // the app "wire copy", and verified-news had 0 images in 49 posts.
  "at://did:plc:aqas4wywoe44zdhz6tsc7wc7/app.bsky.feed.generator/aaahy7kprt3xy",
  "at://did:plc:aqas4wywoe44zdhz6tsc7wc7/app.bsky.feed.generator/aaagszaa6pbug",
  "at://did:plc:rmnjia7e5eh3jamsizupx5yc/app.bsky.feed.generator/aaalrzaywm6ls",
  "at://did:plc:7mtqkeetxgxqfyhyi2dnyga2/app.bsky.feed.generator/aaadhh6hwvaca",
  // WORLD lane: every feed above is US + Middle-East politics (296 live posts, ZERO
  // Nepal mentions while its flood toll passed 1,300). Mostly wire copy the gate
  // refuses, but fast disaster reports pass feedGate's breaking exemption.
  "at://did:plc:3sn6bogankaicebzdb7liro3/app.bsky.feed.generator/aaajaq4ut77am",
  // whats-hot kept LAST: ~7% on-topic but the most media; the tag gate drops the rest.
  "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot"
];
var _bskyCursors = {};
var _bskyIdx = 0;
function loadBsky() {
  try {
    _bskyCursors = JSON.parse(env.storage.getItem("void_bsky_cursors") || "{}") || {};
  } catch {
    _bskyCursors = {};
  }
  _bskyIdx = parseInt(env.storage.getItem("void_bsky_idx") || "0", 10) || 0;
}
loadBsky();
onConfigure(loadBsky);

// scripts/curator.mjs
var import_meta = {};
var DIR = process.env.CURATOR_DIR || import_node_path.default.join(import_node_path.default.dirname(import_node_path.default.dirname((0, import_node_url.fileURLToPath)(import_meta.url))), "scripts");
var STORE = import_node_path.default.join(DIR, "curated.json");
var PUBLIC = import_node_path.default.join(DIR, "curated.public.json");
var OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
var OLLAMA_TASK = process.env.OLLAMA_TASK || "VoidOllama";
var LLM_URL = (process.env.LLM_URL || "").replace(/\/+$/, "");
var LLM_KEY = process.env.LLM_KEY || "";
var ollamaUp = () => fetch(OLLAMA + "/api/tags").then((r) => r.ok).catch(() => false);
async function ensureOllama() {
  if (LLM_URL) return true;
  if (await ollamaUp()) return true;
  try {
    (0, import_node_child_process.execFileSync)("schtasks", ["/run", "/tn", OLLAMA_TASK], { stdio: "ignore", timeout: 2e4 });
  } catch (e) {
    log("  could not run task " + OLLAMA_TASK + ": " + e.message);
    return false;
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1e3));
    if (await ollamaUp()) {
      log("  started ollama via task " + OLLAMA_TASK);
      return true;
    }
  }
  return false;
}
var MODEL = process.env.CURATOR_MODEL || "qwen2.5:3b";
async function chatJSON(system, user) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let r;
  try {
    r = LLM_URL ? await fetch(LLM_URL + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...LLM_KEY ? { authorization: "Bearer " + LLM_KEY } : {} },
      body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" }, messages }),
      signal: AbortSignal.timeout(9e4)
    }) : await fetch(OLLAMA + "/api/chat", { method: "POST", body: JSON.stringify({ model: MODEL, stream: false, format: "json", keep_alive: "2m", options: { temperature: 0, num_ctx: 2048 }, messages }) });
  } catch {
    return null;
  }
  const j = await r.json();
  if (LLM_URL) {
    if (!r.ok) throw new Error(r.status + " " + JSON.stringify(j).slice(0, 120));
    return j.choices[0].message.content;
  }
  return j.message.content;
}
var PROXY = process.env.PROXY_BASE || "https://void-proxy-production.up.railway.app";
var EVERY = parseInt(process.env.CURATOR_EVERY_MS, 10) || 5 * 60 * 1e3;
var UA = "void-curator/1";
var FEEDS = [
  "at://did:plc:muhesxre7yfcuqi5ss2fskjc/app.bsky.feed.generator/aaaouj7mhcsuq",
  "at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/app.bsky.feed.generator/og-videos-kps"
];
var TERMS = ["footage", "police", "protest", "breaking"];
var BATCH = 5;
var MAX_BATCHES = 6;
var KEEP_MS = 72 * 36e5;
var PUBLIC_N = 60;
var args = process.argv.slice(2);
var ONCE = args.includes("--once");
var DRY = args.includes("--dry");
var log = (m) => console.log((/* @__PURE__ */ new Date()).toISOString() + " " + m);
async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8e3);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(r.status + " " + (await r.text().catch(() => "")).slice(0, 80));
    return await r.json();
  } catch (e) {
    log(`  fetch failed ${url.slice(0, 80)}: ${e.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}
function fromBskyPost(post) {
  const e = post && post.embed;
  if (!e || !e.playlist) return null;
  return {
    platform: "bluesky",
    text: post.record && post.record.text || "",
    createdAt: post.record && post.record.createdAt || post.indexedAt || (/* @__PURE__ */ new Date()).toISOString(),
    likes: post.likeCount || 0,
    reposts: post.repostCount || 0,
    video: e.playlist,
    thumb: e.thumbnail || "",
    url: post.uri && post.author ? `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}` : "",
    graphic: (post.labels || []).some((l) => /graphic|gore|corpse|violence|nudity|porn|sexual/i.test(l.val || ""))
  };
}
async function scout() {
  const out = [];
  const reels = await getJSON(`${PROXY}/reels?limit=30`);
  for (const it of reels && reels.items || []) {
    const v = (it.media || []).find((m) => m.type === "video" && m.url);
    if (!v) continue;
    out.push({ platform: it.platform || "x", text: it.text || "", createdAt: it.createdAt, likes: it.metrics && it.metrics.score || 0, reposts: 0, video: v.url, thumb: v.thumb || "", url: it.url || "", graphic: !!it.graphic });
  }
  for (const f of FEEDS) {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(f)}&limit=50`);
    for (const fi of d && d.feed || []) {
      const c = fromBskyPost(fi.post);
      if (c) out.push(c);
    }
  }
  const since = new Date(Date.now() - 48 * 36e5).toISOString();
  for (const q of TERMS) {
    const d = await getJSON(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q}&sort=top&since=${since}&limit=50`);
    for (const p of d && d.posts || []) {
      const c = fromBskyPost(p);
      if (c) out.push(c);
    }
  }
  return out;
}
function keyOf(video) {
  const m = /\/watch\/[^/]+\/([a-z0-9]{20,})\//i.exec(video);
  return m ? "cid:" + m[1] : video.split("?")[0];
}
var SYSTEM = `You label short video clips for a news-and-current-events feed. Reply JSON only: {"items":[{"i":<n>,"genre":"news"|"politics"|"conflict"|"crime"|"accident"|"protest"|"sport"|"entertainment"|"hobby"|"art"|"animals"|"other","topic":"<short phrase>","viral_news_fit":<0-1, how much this is a fresh real-world incident clip people share and argue about: bodycam, caught on camera, strikes, protests, breaking>,"graphic":<true|false: blood, death, serious injury, war footage>,"caption":"<one clean line, max 110 chars>"}]}. One entry per numbered input line.`;
async function labelBatch(batch) {
  const lines = batch.map((c, i) => `${i}. ${c.platform} | ${c.text.replace(/\s+/g, " ").slice(0, 240)} | likes ${c.likes} | age ${Math.max(0, Math.round((Date.now() - Date.parse(c.createdAt)) / 36e5))}h`).join("\n");
  let best = null;
  for (let t = 0; t < 2; t++) {
    try {
      const reply = await chatJSON(SYSTEM, lines);
      if (reply === null) return "down";
      const out = JSON.parse(reply);
      const by = new Map((out.items || []).map((x) => [Number(x.i), x]));
      if (batch.every((_, i) => by.has(i))) return by;
      if (!best || by.size > best.size) best = by;
      log(`  label batch incomplete (${t + 1}/2): ${by.size}/${batch.length}`);
    } catch (e) {
      log(`  label batch failed (${t + 1}/2): ${e.message}`);
    }
  }
  return best && best.size ? best : null;
}
function writeAtomic(file, data) {
  (0, import_node_fs.writeFileSync)(file + ".tmp", JSON.stringify(data));
  (0, import_node_fs.renameSync)(file + ".tmp", file);
}
function rank(c, now) {
  const fresh = Math.max(0, 1 - (now - Date.parse(c.createdAt)) / KEEP_MS);
  return c.fit * 0.6 + Math.log10(1 + c.likes) * 0.1 + fresh;
}
var KEY_FILE = process.env.CURATOR_KEY_FILE || import_node_path.default.join(import_node_os.default.homedir(), ".void", "curator.key");
var KEY_FILE_OLD = "E:/tmp/curator.key";
function curatorKey() {
  if (process.env.CURATOR_KEY) return process.env.CURATOR_KEY;
  for (const f of [KEY_FILE, KEY_FILE_OLD]) {
    try {
      const k = (0, import_node_fs.readFileSync)(f, "utf8").trim();
      if (k) return k;
    } catch {
    }
  }
  return "";
}
async function pushCurated(items) {
  const key = curatorKey();
  if (!key) {
    log("push skipped: no CURATOR_KEY (env or " + KEY_FILE + ")");
    return;
  }
  try {
    const r = await fetch(PROXY + "/curated/ingest", { method: "POST", headers: { "content-type": "application/json", "x-curator-key": key, "user-agent": "void-curator/1" }, body: JSON.stringify({ generated: (/* @__PURE__ */ new Date()).toISOString(), items }), signal: AbortSignal.timeout(45e3) });
    const t = await r.text();
    log("push " + r.status + " " + t.slice(0, 80));
  } catch (e) {
    log("push failed: " + (e && e.message));
  }
}
var SLOP_STORE = import_node_path.default.join(DIR, "slop.json");
var SLOP_KEEP_MS = 48 * 36e5;
var SLOP_MAX = 30;
var SLOP_PUSH_MIN = 0.5;
var SLOP_SYSTEM = `You screen social posts for a feed that only wants real people saying real things. Score each from 0 to 1 for slop. 1 = AI-generated filler, engagement bait, ads or spam, generic motivation or self-help, rage-bait or clickbait, content-farm or bot copy. 0 = a person's own voice: an opinion, eyewitness report, joke, question or argument, even blunt, angry or political. Reply JSON only: {"items":[{"i":<n>,"slop":<0-1>}]}. One entry per numbered line.`;
var PERSONAL = /\b(?:i|i'm|im|my|me|we|our|us)\b/i;
function slopCandidate(text) {
  const sc = slopScore({ body: text });
  if (sc >= SLOP_HARD) return false;
  return sc >= 0.2 || text.length >= 160 && !PERSONAL.test(text);
}
async function slopBatch(texts) {
  const user = texts.map((t, i) => `${i}. ${t.replace(/\s+/g, " ").slice(0, 280)}`).join("\n");
  let best = null;
  for (let t = 0; t < 2; t++) {
    try {
      const reply = await chatJSON(SLOP_SYSTEM, user);
      if (reply === null) return "down";
      const by = new Map((JSON.parse(reply).items || []).map((x) => [Number(x.i), Math.max(0, Math.min(1, Number(x.slop) || 0))]));
      if (texts.every((_, i) => by.has(i))) return by;
      if (!best || by.size > best.size) best = by;
    } catch (e) {
      log(`  slop batch failed (${t + 1}/2): ${e.message}`);
    }
  }
  return best;
}
async function pushSlop(items) {
  const key = curatorKey();
  if (!key) {
    log("slop push skipped: no CURATOR_KEY");
    return;
  }
  try {
    const r = await fetch(PROXY + "/slop/ingest", { method: "POST", headers: { "content-type": "application/json", "x-curator-key": key, "user-agent": UA }, body: JSON.stringify({ generated: (/* @__PURE__ */ new Date()).toISOString(), items }), signal: AbortSignal.timeout(3e4) });
    log("slop push " + r.status + " " + (await r.text()).slice(0, 60));
  } catch (e) {
    log("slop push failed: " + (e && e.message));
  }
}
async function slopPass(up) {
  let store = { items: {} };
  try {
    store = JSON.parse((0, import_node_fs.readFileSync)(SLOP_STORE, "utf8"));
  } catch {
  }
  const items = store.items || (store.items = {});
  const texts = [];
  for (const f of BSKY_FEEDS) {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(f)}&limit=50`);
    for (const fi of d && d.feed || []) texts.push(String(fi.post && fi.post.record && fi.post.record.text || ""));
  }
  const px = await getJSON(`${PROXY}/feed?mode=tension&limit=50`);
  for (const it of px && px.items || []) texts.push(String(it.text || ""));
  const queue = /* @__PURE__ */ new Map();
  for (const t of texts) {
    const k = slopKey({ body: t });
    if (t && !items[k] && !queue.has(k) && slopCandidate(t)) queue.set(k, t);
  }
  const todo = [...queue].slice(0, SLOP_MAX);
  let scored = 0;
  for (let b = 0; up && b * BATCH < todo.length; b++) {
    const batch = todo.slice(b * BATCH, (b + 1) * BATCH);
    const by = await slopBatch(batch.map(([, t]) => t));
    if (by === "down") {
      log("  model went away during slop scoring");
      break;
    }
    batch.forEach(([k, t], i) => {
      if (by && by.has(i)) {
        items[k] = { s: by.get(i), t: Date.now() };
        scored++;
        if (DRY) log(`  slop ${by.get(i).toFixed(2)} "${t.slice(0, 80)}"`);
      }
    });
  }
  const now = Date.now();
  for (const k in items) if (now - items[k].t > SLOP_KEEP_MS) delete items[k];
  const flagged = Object.entries(items).filter(([, v]) => v.s >= SLOP_PUSH_MIN).map(([k, v]) => ({ k, s: v.s }));
  log(`slop: read ${texts.length}, borderline new ${queue.size}, scored ${scored}, held ${Object.keys(items).length}, flagged ${flagged.length}${DRY ? " (dry)" : ""}`);
  if (!DRY) {
    writeAtomic(SLOP_STORE, store);
    if (Object.keys(items).length) await pushSlop(flagged);
  }
}
var LOCK = import_node_path.default.join(DIR, ".curator.lock");
function takeLock() {
  try {
    const st = (0, import_node_fs.statSync)(LOCK);
    const pid = Number((0, import_node_fs.readFileSync)(LOCK, "utf8")) || 0;
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = pid > 0;
    } catch {
    }
    if (alive && Date.now() - st.mtimeMs < 2 * 60 * 60 * 1e3) return false;
  } catch {
  }
  (0, import_node_fs.writeFileSync)(LOCK, String(process.pid));
  return true;
}
function dropLock() {
  try {
    (0, import_node_fs.unlinkSync)(LOCK);
  } catch {
  }
}
async function pass() {
  const t0 = Date.now();
  let store = { generated: "", items: {} };
  try {
    store = JSON.parse((0, import_node_fs.readFileSync)(STORE, "utf8"));
  } catch {
  }
  const items = store.items || (store.items = {});
  const scouted = await scout();
  const fresh = /* @__PURE__ */ new Map();
  for (const c of scouted) {
    const k = keyOf(c.video);
    if (!items[k] && !fresh.has(k)) fresh.set(k, { key: k, ...c });
  }
  const queue = [...fresh.values()];
  let labeled = 0, errors = 0;
  const up = queue.length ? await ensureOllama() : true;
  if (!up) log("  model unreachable at " + (LLM_URL || OLLAMA) + " - labeling skipped this pass");
  for (let b = 0; up && b < MAX_BATCHES && b * BATCH < queue.length; b++) {
    const batch = queue.slice(b * BATCH, (b + 1) * BATCH);
    const tb = Date.now();
    const by = await labelBatch(batch);
    if (by === "down") {
      log(`  model went away during batch ${b + 1} - rest waits for next pass`);
      break;
    }
    log(`  batch ${b + 1}: ${batch.length} clips ${Date.now() - tb}ms ${by ? "ok" : "FAILED"}`);
    batch.forEach((c, i) => {
      const v = by && by.get(i);
      const now2 = (/* @__PURE__ */ new Date()).toISOString();
      if (!v) {
        if (by && by.size) return;
        errors++;
        items[c.key] = { ...c, error: true, labeledAt: now2 };
        return;
      }
      labeled++;
      items[c.key] = { ...c, caption: String(v.caption || c.text).slice(0, 110), genre: String(v.genre || "other"), topic: String(v.topic || ""), fit: Math.min(1, Math.max(0, Number(v.viral_news_fit) || 0)), graphic: c.graphic || v.graphic === true, labeledAt: now2 };
    });
  }
  const now = Date.now();
  for (const k in items) if (now - Date.parse(items[k].createdAt) > KEEP_MS) delete items[k];
  const pub = Object.values(items).filter((c) => !c.error).sort((a, b) => rank(b, now) - rank(a, now)).slice(0, PUBLIC_N);
  if (!DRY) {
    store.generated = (/* @__PURE__ */ new Date()).toISOString();
    writeAtomic(STORE, store);
    writeAtomic(PUBLIC, { generated: store.generated, items: pub });
  }
  log(`pass: scouted ${scouted.length}, new ${queue.length}, labeled ${labeled}, errors ${errors}, store ${Object.keys(items).length}, public ${pub.length}, ${Date.now() - t0}ms${DRY ? " (dry)" : ""}`);
  if (!DRY && pub.length) await pushCurated(pub);
  if (DRY) for (const c of Object.values(items).filter((c2) => !c2.error && c2.labeledAt >= new Date(t0).toISOString()).slice(0, 3)) log(`  sample ${c.genre} fit=${c.fit} graphic=${c.graphic} "${c.caption}"`);
  try {
    await slopPass(up && (queue.length ? true : await ensureOllama()));
  } catch (e) {
    log("slop pass failed: " + (e && e.message));
  }
}
(async () => {
  log(`curator start (once=${ONCE} dry=${DRY} model=${MODEL} via ${LLM_URL ? "api" : "ollama"})`);
  for (; ; ) {
    if (!takeLock()) {
      log("another pass is running - skipped");
      if (ONCE) break;
      await new Promise((r) => setTimeout(r, EVERY));
      continue;
    }
    try {
      await pass();
    } catch (e) {
      log("pass failed: " + (e && e.message));
    } finally {
      dropLock();
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, EVERY));
  }
})();
