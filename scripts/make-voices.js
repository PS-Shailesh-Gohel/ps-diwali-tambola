#!/usr/bin/env node
'use strict';
// Records all 90 number calls as audio files ("62. Sixty-two, a laddoo for you") in the Mac's
// Indian English male voice (Rishi) and an English female voice,
// using the Mac's built-in "say" and "afconvert" commands. Run once on a Mac:
//
//   npm run voices
//
// Output: public/audio/calls/m/1.m4a ... 90.m4a (male) and public/audio/calls/f/... (female)
// Pick other voices with:  MALE_VOICE="Rishi" FEMALE_VOICE="Lekha" npm run voices
// Want your own recordings instead? Put 1.m4a ... 90.m4a (or .mp3) in those folders - see README.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spokenCall } = require('../server/calls');

if (process.platform !== 'darwin') {
  console.error('This script uses the Mac "say" command, so run it on a Mac.');
  process.exit(1);
}

// "Rishi               en_IN    # Hello! My name is Rishi."
const installed = execFileSync('say', ['-v', '?'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.match(/^(.+?)\s+([a-z]{2}[_-][A-Z]{2})\s+#/))
  .filter(Boolean)
  .map((m) => ({ name: m[1].trim(), lang: m[2].replace('-', '_') }));

const indian = installed.filter((v) => /^en_IN$/.test(v.lang));
const english = installed.filter((v) => /^en_/.test(v.lang));
const find = (wanted, candidates) => {
  if (wanted) {
    const v = installed.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
    if (!v) { console.error(`Voice "${wanted}" is not installed. Installed Indian voices: ${indian.map((x) => x.name).join(', ') || 'none'}`); process.exit(1); }
    return v;
  }
  for (const c of candidates) {
    const enhanced = indian.find((x) => x.name.toLowerCase().startsWith(c) && /enhanced|premium/i.test(x.name));
    const plain = indian.find((x) => x.name.toLowerCase().startsWith(c));
    if (enhanced || plain) return enhanced || plain;
  }
  return null;
};

const male = find(process.env.MALE_VOICE, ['rishi', 'aman', 'ravi', 'hemant']);
let female = find(process.env.FEMALE_VOICE, ['veena', 'isha', 'kajal', 'neerja']);
if (!female && !process.env.FEMALE_VOICE) female = english.find((v) => /^(samantha|karen|moira|tessa|serena|fiona|victoria)/i.test(v.name)) || null;

if (!male && !female) {
  console.error('No Indian voices found. Add "Rishi" (male) and "Veena" or "Lekha" (female):');
  console.error('System Settings > Accessibility > Spoken Content > System voice > Manage Voices > English (India) / Hindi (India).');
  process.exit(1);
}
console.log(`Male voice:   ${male ? `${male.name} (${male.lang})` : 'not found - male calls will use the browser voice'}`);
console.log(`Female voice: ${female ? `${female.name} (${female.lang})` : 'not found - female calls will use the browser voice'}`);

// The number once, then the rest of the rhyme: "79, one more time"
function textFor(n) {
  return spokenCall(n).replace(/^(\d+), /, '$1, [[slnc 250]] ');
}

const outRoot = path.join(__dirname, '..', 'public', 'audio', 'calls');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tambola-voices-'));

function record(voice, folder) {
  if (!voice) return 0;
  const dir = path.join(outRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  let made = 0;
  for (let n = 1; n <= 90; n++) {
    const aiff = path.join(tmp, `${folder}-${n}.aiff`);
    const out = path.join(dir, `${n}.m4a`);
    execFileSync('say', ['-v', voice.name, '-r', '170', '-o', aiff, textFor(n)]);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, out]);
    fs.unlinkSync(aiff);
    made++;
    process.stdout.write(`\r${folder === 'm' ? 'Male  ' : 'Female'} ${n}/90`);
  }
  process.stdout.write('\n');
  return made;
}

const total = record(male, 'm') + record(female, 'f');
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(outRoot, 'voices.json'), JSON.stringify({
  male: male ? male.name : null, female: female ? female.name : null, ext: 'm4a', createdAt: new Date().toISOString()
}, null, 2));
console.log(`Done: ${total} audio files in public/audio/calls. Refresh the projector page and click "Test voices".`);
