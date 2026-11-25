// STEP 4: Why do we pair?
// Problem: radio waves go everywhere, so a neighbour's phone can hear your music too.
// Fix: pairing. Phone and headphones each bring a colour, mix them into ONE
// secret colour only they know (the "key"), then lock every message with it.
// The neighbour still receives the waves, but only gets gibberish.

import * as THREE from 'three';
import { makePhone, makeHeadphones, makeFloor, makeLabel, setLabelText, glassMaterial, disposeGroup } from '../models.js';
import { addButtonRow } from '../ui.js';

export const info = {
  title: 'Why do I have to pair?',
  problem: 'Radio waves go everywhere, so anyone nearby could listen in.',
  answer: 'Pairing makes a secret code only your two devices know, so others hear gibberish.',
  tryThis: 'Press Pair and watch the neighbour.',
  camera: { position: [0, 7, 17], target: [0, 2, 1] },
};

// Where things stand (x, y, z). The neighbour is off to the side, nearer the camera.
const PHONE = new THREE.Vector3(-4.5, 0, 0);
const HEAD = new THREE.Vector3(4.5, 0, 0);
const NEIGHBOUR = new THREE.Vector3(0, 0, 5);
const SECRET = 0xa45cff; // the mixed "secret colour" (red + blue = purple)

export function start(world, panel) {
  const group = new THREE.Group();
  world.scene.add(group);
  group.add(makeFloor());

  // --- the three devices ---
  const phone = makePhone();
  phone.position.copy(PHONE);
  phone.scale.setScalar(1.5);
  const head = makeHeadphones();
  head.position.copy(HEAD);
  head.scale.setScalar(1.5);
  const neighbour = makePhone(); // someone else's phone nearby
  neighbour.position.copy(NEIGHBOUR);
  neighbour.scale.setScalar(1.1);
  neighbour.rotation.y = Math.PI; // facing away: just a stranger
  group.add(phone, head, neighbour);

  // --- floating labels ---
  const phoneLabel = makeLabel('📱 Your phone', { size: 0.9 });
  phoneLabel.position.set(PHONE.x, 3.6, 0);
  const headLabel = makeLabel('🎧 Your headphones', { size: 0.9 });
  headLabel.position.set(HEAD.x, 3.6, 0);
  const neighbourLabel = makeLabel('', { size: 0.9 });
  neighbourLabel.position.set(NEIGHBOUR.x, 2.9, NEIGHBOUR.z);
  group.add(phoneLabel, headLabel, neighbourLabel);

  // A glowing ring under each of your devices: grey before pairing, purple after.
  const rings = [PHONE, HEAD].map((p) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.06, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xbbbbbb })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.08, p.z);
    group.add(ring);
    return ring;
  });

  // Paint orbs used in the pairing animation: red from the phone, blue from the headphones.
  const makeOrb = (color) => {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 16), glassMaterial(color));
    orb.visible = false;
    group.add(orb);
    return orb;
  };
  const redOrb = makeOrb(0xff4d6d);
  const blueOrb = makeOrb(0x3d7bff);

  // --- state ---
  let mode = 'open'; // 'open' (not paired) -> 'pairing' -> 'paired'
  let pairTime = 0; // seconds into the pairing animation
  let spawnTimer = 0;
  let toNeighbour = false; // alternate notes between headphones and neighbour
  const notes = []; // flying notes: { sprite, from, to, t, garbled }

  function setMode(next) {
    mode = next;
    pairTime = 0;
    const paired = mode === 'paired';
    rings.forEach((r) => r.material.color.set(paired ? SECRET : 0xbbbbbb));
    setLabelText(phoneLabel, paired ? '📱 🔑 Secret code' : '📱 Your phone', { size: 0.9 });
    setLabelText(headLabel, paired ? '🎧 Only I can play this 🎵' : '🎧 Your headphones', { size: 0.9 });
    setLabelText(
      neighbourLabel,
      mode === 'open' ? '👀 Neighbour: I can hear your music!' : mode === 'pairing' ? '👀 ...' : '❓ Neighbour: just gibberish',
      { size: 0.9, color: paired ? '#6b6680' : '#d0304f' }
    );
    redOrb.visible = blueOrb.visible = mode === 'pairing';
  }
  setMode('open');

  addButtonRow(panel, [
    { label: '🔑 Pair', primary: true, onClick: () => mode === 'open' && setMode('pairing') },
    { label: 'Reset', onClick: () => setMode('open') },
  ]);

  // Send one note from the phone, to the headphones or the neighbour.
  function sendNote() {
    const locked = mode === 'paired';
    const sprite = makeLabel(locked ? '🔒' : '🎵', { size: 1.1 });
    const from = new THREE.Vector3(PHONE.x, 2, 0);
    const to = toNeighbour ? new THREE.Vector3(NEIGHBOUR.x, 1.6, NEIGHBOUR.z) : new THREE.Vector3(HEAD.x, 2, 0);
    // A locked note reaching the neighbour turns into "?": they can't read it.
    notes.push({ sprite, from, to, t: 0, garble: locked && toNeighbour });
    group.add(sprite);
    toNeighbour = !toNeighbour;
  }

  // Lerp between two points with a little hop in the middle.
  function arc(out, a, b, t, height) {
    out.lerpVectors(a, b, t);
    out.y += Math.sin(t * Math.PI) * height;
  }

  function update(dt) {
    // 1. Music notes keep flowing (paused while pairing).
    if (mode !== 'pairing') {
      spawnTimer += dt;
      if (spawnTimer > 0.45) {
        spawnTimer = 0;
        sendNote();
      }
    }
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      n.t += dt / 1.6;
      arc(n.sprite.position, n.from, n.to, Math.min(n.t, 1), 1.2);
      if (n.garble && n.t > 0.75 && !n.done) {
        setLabelText(n.sprite, '❓', { size: 1.1 });
        n.done = true;
      }
      if (n.t >= 1) {
        group.remove(n.sprite);
        n.sprite.material.map.dispose();
        n.sprite.material.dispose();
        notes.splice(i, 1);
      }
    }

    // 2. Pairing animation: orbs meet in the middle, mix to purple, fly back.
    if (mode === 'pairing') {
      pairTime += dt;
      const mid = new THREE.Vector3(0, 3, 0);
      const phoneTop = new THREE.Vector3(PHONE.x, 2.5, 0);
      const headTop = new THREE.Vector3(HEAD.x, 2.5, 0);
      if (pairTime < 1.5) {
        // fly in
        const t = pairTime / 1.5;
        arc(redOrb.position, phoneTop, mid, t, 1);
        arc(blueOrb.position, headTop, mid, t, 1);
      } else if (pairTime < 2.3) {
        // mix: both become the same secret colour
        redOrb.material.color.set(SECRET);
        blueOrb.material.color.set(SECRET);
        const s = 1 + Math.sin((pairTime - 1.5) * 8) * 0.25;
        redOrb.scale.setScalar(s);
        blueOrb.scale.setScalar(s);
      } else if (pairTime < 3.8) {
        // each device takes a copy home
        const t = (pairTime - 2.3) / 1.5;
        arc(redOrb.position, mid, phoneTop, t, 1);
        arc(blueOrb.position, mid, headTop, t, 1);
      } else {
        redOrb.material.color.set(0xff4d6d);
        blueOrb.material.color.set(0x3d7bff);
        redOrb.scale.setScalar(1);
        blueOrb.scale.setScalar(1);
        setMode('paired');
      }
    }

    // 3. Paired rings gently pulse.
    const pulse = mode === 'paired' ? 1 + Math.sin(performance.now() / 300) * 0.06 : 1;
    rings.forEach((r) => r.scale.setScalar(pulse));
  }

  function stop() {
    disposeGroup(group); // also frees the flying notes still in the group
  }

  return { update, stop };
}
