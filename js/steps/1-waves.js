// STEP 1: Music flies through the air on invisible radio waves.
// The phone sends waves out in every direction, like ripples in a pond.
// They fade with distance, and a wall soaks up part of them.
// Too weak = the headphones can't hear the phone, so the music stops.

import * as THREE from 'three';
import { makePhone, makeHeadphones, makeFloor, makeLabel, setLabelText, glassMaterial, disposeGroup } from '../models.js';
import { makeObjectDraggable } from '../drag.js';
import { addToggle } from '../ui.js';
import { setMusicConnected } from '../sound.js';

// Words for the explanation panel + where the camera goes (read by main.js).
export const info = {
  title: 'How does music fly through the air?',
  problem: 'There’s no cable, so how does the music reach your ears?',
  answer: 'Invisible radio waves carry it, but they fade with distance and walls.',
  tryThis: 'Drag the headphones away, then add a wall.',
  camera: { position: [0, 15, 24], target: [0, 0, 2] },
};

// How far the waves reach in the open (scene units), and how much a wall keeps.
const REACH = 14;
const WALL_KEEPS = 0.5; // a wall lets only half the signal through

// Signal strength at a distance: 1 = right next to the phone, 0 = nothing left.
function strengthAt(distance, behindWall) {
  const s = Math.max(0, 1 - distance / REACH);
  return behindWall ? s * WALL_KEEPS : s;
}

export function start(world, panel) {
  const group = new THREE.Group();
  world.scene.add(group);
  group.add(makeFloor());

  // The phone in the middle.
  const phone = makePhone();
  group.add(phone);
  const phoneLabel = makeLabel('📱 Phone');
  phoneLabel.position.set(0, 2.2, 0);
  phone.add(phoneLabel);

  // The headphones you can drag. Their label shows the signal live.
  const headphones = makeHeadphones();
  headphones.position.set(4, 0, 5);
  group.add(headphones);
  const statusLabel = makeLabel('…');
  statusLabel.position.set(0, 2.1, 0);
  headphones.add(statusLabel);

  // A wall you can slide left/right (hidden until the toggle is on).
  const wall = new THREE.Group();
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 8), glassMaterial(0xf6a5c8, 0.6));
  wallMesh.position.y = 1.5;
  wall.add(wallMesh);
  const wallLabel = makeLabel('🧱 Wall: blocks some signal', { color: '#b0306a', size: 1.3 });
  wallLabel.position.set(0, 3.6, 0);
  wall.add(wallLabel);
  wall.position.x = 2.5;
  wall.visible = false;
  group.add(wall);

  // The wall's "shadow": a grey patch on the floor where the signal is weaker.
  // 4 corners: the wall's two ends, and those ends pushed far away from the phone.
  const shadowShape = new THREE.BufferGeometry();
  shadowShape.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  shadowShape.setIndex([0, 1, 2, 0, 2, 3]);
  const shadow = new THREE.Mesh(
    shadowShape,
    new THREE.MeshBasicMaterial({ color: 0x55506a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  shadow.position.y = 0.01;
  group.add(shadow);

  function drawShadow() {
    const x = wall.position.x;
    const ends = [wall.position.z - 4, wall.position.z + 4];
    const far = ends.map((z) => REACH / Math.hypot(x, z)); // stretch out to where the waves end
    const pos = shadowShape.attributes.position;
    pos.setXYZ(0, x, 0, ends[0]);
    pos.setXYZ(1, x, 0, ends[1]);
    pos.setXYZ(2, x * far[1], 0, ends[1] * far[1]);
    pos.setXYZ(3, x * far[0], 0, ends[0] * far[0]);
    pos.needsUpdate = true;
    shadowShape.computeBoundingSphere();
    shadow.visible = wall.visible;
  }

  // Is the wall between the phone (at 0,0) and the spot (x, z)?
  function wallBlocks(x, z) {
    if (!wall.visible) return false;
    const wx = wall.position.x;
    if (Math.sign(wx) === Math.sign(wx - x)) return false; // same side as the phone
    return Math.abs((z * wx) / x - wall.position.z) < 4; // line crosses the wall
  }

  // The waves: rings of dots growing out from the phone, plus a faint dome.
  // Each dot checks "is the wall in my way?" and turns grey and faint if so.
  const WAVE_COUNT = 8;
  const DOTS = 160;
  const domeShape = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const waves = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const dome = new THREE.Mesh(
      domeShape,
      new THREE.MeshBasicMaterial({ color: 0x8b6cf6, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    const dots = new THREE.BufferGeometry();
    dots.setAttribute('position', new THREE.Float32BufferAttribute(new Array(DOTS * 3).fill(0), 3));
    dots.setAttribute('color', new THREE.Float32BufferAttribute(new Array(DOTS * 4).fill(1), 4));
    const ring = new THREE.Points(
      dots,
      new THREE.PointsMaterial({ size: 0.4, vertexColors: true, transparent: true, depthWrite: false })
    );
    group.add(dome, ring);
    waves.push({ dome, ring, offset: i / WAVE_COUNT });
  }

  // A line from phone to headphones, coloured by signal strength.
  const link = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x22b07d })
  );
  group.add(link);

  // The one control: put the wall in or take it out.
  addToggle(panel, {
    label: 'Put a wall in the way',
    value: false,
    onChange: (on) => {
      wall.visible = on;
      updateSignal();
    },
  });

  // Recalculate the signal at the headphones and show it in the scene.
  let lastText = '';
  function updateSignal() {
    drawShadow();
    const { x, z } = headphones.position;
    const blocked = wallBlocks(x, z);
    const s = strengthAt(Math.hypot(x, z), blocked);
    const connected = s > 0.05;
    setMusicConnected(connected);

    let text = '📶 Strong signal';
    let color = '#1a9a6c';
    if (!connected) [text, color] = ['🔇 Too weak: music stops', '#d63a3f'];
    else if (s < 0.35) [text, color] = [blocked ? '📶 Weak (the wall)' : '📶 Weak signal', '#d9800f'];
    if (text !== lastText) {
      setLabelText(statusLabel, text, { color, size: 1.2 });
      lastText = text;
    }

    headphones.userData.glow.material.color.set(color);
    link.material.color.set(color);
    link.visible = connected;
    const pos = link.geometry.attributes.position;
    pos.setXYZ(0, 0, 1.2, 0);
    pos.setXYZ(1, x, 1, z);
    pos.needsUpdate = true;
  }

  const stopDragHeadphones = makeObjectDraggable(world, headphones, { limit: 20, onMove: updateSignal });
  const stopDragWall = makeObjectDraggable(world, wall, { limit: 18, axis: 'x', onMove: updateSignal });
  updateSignal();

  let clock = 0;
  return {
    update(dt) {
      clock += dt * 0.15;
      for (const w of waves) {
        const progress = (clock + w.offset) % 1;
        const r = 0.3 + progress * REACH;
        w.dome.scale.setScalar(r);
        w.dome.material.opacity = 0.1 * (1 - progress);

        // Place the dots on a circle. Open air: bright purple, fading with distance.
        // Behind the wall: grey and much fainter (and gone sooner).
        const positions = w.ring.geometry.attributes.position;
        const colors = w.ring.geometry.attributes.color;
        for (let j = 0; j < DOTS; j++) {
          const angle = (j / DOTS) * Math.PI * 2;
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          positions.setXYZ(j, x, 0.02, z);
          const blocked = wallBlocks(x, z);
          const s = strengthAt(r, blocked);
          if (blocked) colors.setXYZW(j, 0.6, 0.6, 0.65, s * 0.9);
          else colors.setXYZW(j, 0.43, 0.31, 0.94, s);
        }
        positions.needsUpdate = true;
        colors.needsUpdate = true;
      }
      // Headphones bob gently while music is playing.
      if (link.visible) headphones.children[0].position.y = 0.95 + Math.sin(performance.now() / 200) * 0.03;
    },
    stop() {
      stopDragHeadphones();
      stopDragWall();
      disposeGroup(group);
    },
  };
}
