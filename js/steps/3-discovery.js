// STEP 3: How does the phone find the headphones?
// Every gadget keeps calling out "I'm here!". The phone listens, and any
// gadget it hears gets a ✅. Gadgets outside the phone's hearing circle are
// too far away: the phone never hears them.

import * as THREE from 'three';
import { makePhone, makeHeadphones, makeWatch, makeSpeaker, makeBulb, makeFloor, makeLabel, setLabelText, disposeGroup } from '../models.js';
import { makeObjectDraggable } from '../drag.js';
import { addButton } from '../ui.js';
import { sfx } from '../sound.js';

// Text for the explanation panel + camera spot (read by main.js).
export const info = {
  title: 'How does my phone find my headphones?',
  problem: 'Your phone can’t connect to something it doesn’t know is there.',
  answer: 'Gadgets keep calling out “I’m here!” and your phone listens.',
  tryThis: 'Drag a gadget far away, then scan.',
  camera: { position: [0, 17, 21], target: [0, 0, 0] },
};

const HEARING = 9; // the phone hears gadgets closer than 9 m
const SHOUT_EVERY = 2.5; // seconds between a gadget's shouts

export function start(world, panel) {
  // Everything goes in one group so stop() can delete it all at once.
  const group = new THREE.Group();
  world.scene.add(group);
  group.add(makeFloor());

  // ----- The phone, with its hearing circle on the floor -----
  const phone = makePhone();
  group.add(phone);
  const phoneLabel = makeLabel('📱 Listening…');
  phoneLabel.position.set(0, 2.6, 0);
  group.add(phoneLabel);

  // A soft blue disc = "the phone can hear anything inside here".
  const circle = new THREE.Mesh(
    new THREE.CircleGeometry(HEARING, 96),
    new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.12 })
  );
  circle.rotation.x = -Math.PI / 2; // lay it flat
  circle.position.y = 0.02;
  group.add(circle);
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(HEARING - 0.08, HEARING, 128),
    new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.03;
  group.add(edge);
  const edgeLabel = makeLabel('👂 Phone can hear this far', { color: '#3a63d8', size: 0.7 });
  edgeLabel.position.set(0, 0.4, HEARING + 0.6);
  group.add(edgeLabel);

  // ----- The gadgets (all draggable) -----
  const gadgets = [
    { name: 'Headphones', icon: '🎧', model: makeHeadphones(), at: [5, 0, 4], color: 0x3fbcb0 },
    { name: 'Watch', icon: '⌚', model: makeWatch(), at: [-6, 0, 3], color: 0xf27bb0 },
    { name: 'Speaker', icon: '🔊', model: makeSpeaker(), at: [5, 0, -5], color: 0x8b6cf6 },
    { name: 'Bulb', icon: '💡', model: makeBulb(), at: [11.5, 0, -2], color: 0xf5c542 }, // starts too far
  ];
  const stopDrags = [];

  for (const g of gadgets) {
    g.model.position.set(...g.at);
    group.add(g.model);

    // Status label above the gadget: name, "✅ Found!" or "Too far".
    g.status = makeLabel(g.name, { size: 1.1 });
    g.status.position.set(0, 1.9, 0);
    g.model.add(g.status);

    // Speech bubble shown for a moment each time it shouts.
    g.bubble = makeLabel(`${g.icon} I’m here!`, { size: 1.1, color: '#3a63d8' });
    g.bubble.position.set(0, 3.4, 0);
    g.bubble.visible = false;
    g.model.add(g.bubble);

    // The shout: a flat ring on the floor that grows and fades.
    g.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    g.ring.rotation.x = -Math.PI / 2;
    g.ring.position.y = 0.05;
    group.add(g.ring);

    // A line from the gadget to the phone that flashes when it is heard.
    g.beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x22b07d, transparent: true, opacity: 0 })
    );
    group.add(g.beam);

    g.timer = Math.random() * SHOUT_EVERY; // stagger the shouts
    g.age = 99; // seconds since its last shout
    g.found = false;
    g.shown = ''; // what the status label says now (so we only redraw on change)

    stopDrags.push(makeObjectDraggable(world, g.model, { limit: 20, onMove: () => showStatus(g) }));
  }

  const isNear = (g) => g.model.position.length() < HEARING;

  // Pick the right status label for a gadget.
  function showStatus(g) {
    let text = g.name, color = '#1c1a24';
    if (g.found) { text = `✅ ${g.name} found!`; color = '#22b07d'; }
    else if (!isNear(g)) { text = '🔇 Too far'; color = '#8a8698'; }
    if (text === g.shown) return;
    g.shown = text;
    setLabelText(g.status, text, { color, size: 1.1 });
  }

  function updatePhoneLabel() {
    const n = gadgets.filter((g) => g.found).length;
    setLabelText(phoneLabel, n ? `📱 Found ${n} gadget${n > 1 ? 's' : ''}` : '📱 Listening…');
  }

  // A gadget calls out "I'm here!".
  function shout(g) {
    g.age = 0;
    if (!isNear(g) || g.found) return;
    // The phone heard it: flash a line and tick it off.
    g.found = true;
    const p = g.model.position;
    g.beam.geometry.setFromPoints([new THREE.Vector3(p.x, 0.6, p.z), new THREE.Vector3(0, 0.6, 0)]);
    sfx.click();
    showStatus(g);
    updatePhoneLabel();
  }

  // ----- The one control -----
  addButton(panel, {
    label: '🔄 Scan again',
    onClick: () => {
      for (const g of gadgets) { g.found = false; showStatus(g); }
      updatePhoneLabel();
    },
  });

  for (const g of gadgets) showStatus(g);

  return {
    update(dt) {
      for (const g of gadgets) {
        g.timer -= dt;
        if (g.timer <= 0) { g.timer = SHOUT_EVERY; shout(g); }
        g.age += dt;

        // Grow the ring outward from the gadget and fade it over 1.2 s.
        const t = Math.min(g.age / 1.2, 1);
        g.ring.position.x = g.model.position.x;
        g.ring.position.z = g.model.position.z;
        g.ring.scale.setScalar(0.5 + t * 3.5);
        g.ring.material.opacity = 0.8 * (1 - t);
        g.bubble.visible = g.age < 1.6;
        // The beam fades too (only lit right after being found).
        g.beam.material.opacity = g.found ? 0.3 + 0.7 * (1 - t) : 0;
      }
    },
    stop() {
      stopDrags.forEach((fn) => fn());
      disposeGroup(group);
    },
  };
}
