// Step 6: why music sometimes stutters, and how Bluetooth fights back.
// Little orbs (bits of music) fly from the phone to the headphones.
// Walls, distance and noisy gadgets knock some out. The headphones keep a
// small "tank" of saved music; if it runs dry, the music stutters.

import * as THREE from 'three';
import { makePhone, makeHeadphones, makeFloor, makeLabel, setLabelText, glassMaterial, disposeGroup } from '../models.js';
import { makeObjectDraggable } from '../drag.js';
import { addToggle } from '../ui.js';

export const info = {
  title: 'Why does my music sometimes stutter?',
  problem: 'Walls, distance and noisy gadgets knock out bits of music on the way.',
  answer: 'Headphones save a little music ahead, and Bluetooth resends what gets lost.',
  tryThis: 'Make trouble, then let Bluetooth fight back.',
  camera: { position: [0, 13, 17], target: [0, 1, 0] },
};

const SEND_RATE = 10; // bits of music sent per second
const PLAY_RATE = 7; // bits the headphones use up per second
const TANK_MAX = 20; // how many bits the tank can hold
const WALL_X = -0.5; // where the wall stands
const COLORS = { ok: 0x8b6cf6, resent: 0xf5c542, lost: 0xff4d4d };

// A simple box with a pink door (microwave) or antennas (router).
function makeGadget(kind) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), glassMaterial(0xf4f2f8));
  body.position.y = 0.4;
  g.add(body);
  if (kind === 'microwave') {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ color: 0xf27bb0 }));
    door.position.set(-0.15, 0.4, 0.46);
    g.add(door);
  } else {
    for (const x of [-0.4, 0.4]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), glassMaterial(0x3fbcb0));
      antenna.position.set(x, 1.1, -0.3);
      g.add(antenna);
    }
  }
  // A red "noise bubble" that pulses around it.
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 16),
    new THREE.MeshBasicMaterial({ color: COLORS.lost, transparent: true, opacity: 0.12, depthWrite: false })
  );
  bubble.position.y = 0.6;
  bubble.raycast = () => {}; // clicks pass through
  g.add(bubble);
  g.userData.bubble = bubble;
  const label = makeLabel(kind === 'microwave' ? '🍿 Microwave' : '📶 Wi-Fi', { size: 0.8 });
  label.position.y = 2;
  g.add(label);
  return g;
}

export function start(world, panel) {
  const group = new THREE.Group();
  world.scene.add(group);
  group.add(makeFloor());

  const phone = makePhone();
  phone.position.set(-5, 0, 0);
  group.add(phone);

  const headphones = makeHeadphones();
  headphones.position.set(4, 0, 0);
  group.add(headphones);
  const dragLabel = makeLabel('Drag me ✋', { size: 0.8 });
  dragLabel.position.set(0, -0.2, 1.3);
  headphones.add(dragLabel);

  // The "saved music" tank floating above the headphones.
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2, 32), glassMaterial(0xffffff, 0.3));
  tank.position.y = 2.6;
  headphones.add(tank);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1, 32), new THREE.MeshBasicMaterial({ color: COLORS.ok }));
  headphones.add(fill);
  const tankLabel = makeLabel('Saved music', { size: 0.7 });
  tankLabel.position.set(1.4, 2.6, 0);
  headphones.add(tankLabel);
  const status = makeLabel('🎵 Playing', { color: '#1f9d6b', size: 1.1 });
  status.position.y = 4.2;
  headphones.add(status);

  // Trouble makers: hidden until "Make trouble" is on.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 7), glassMaterial(0xb8b4c8, 0.6));
  wall.position.set(WALL_X, 1.3, 0);
  const microwave = makeGadget('microwave');
  microwave.position.set(1.8, 0, -2.2);
  const router = makeGadget('router');
  router.position.set(-2.6, 0, 2.2);
  const troubleMakers = [wall, microwave, router];
  for (const t of troubleMakers) {
    t.visible = false;
    group.add(t);
  }

  const stops = [makeObjectDraggable(world, headphones, { limit: 10 })];

  // ----- Controls -----
  let trouble = false;
  let fightBack = false;
  let musicOn = true;
  addToggle(panel, {
    label: '😈 Make trouble',
    value: false,
    onChange: (v) => {
      trouble = v;
      troubleMakers.forEach((t) => (t.visible = v));
      startAudio();
    },
  });
  addToggle(panel, {
    label: '🛡️ Bluetooth fights back',
    value: false,
    onChange: (v) => {
      fightBack = v;
      startAudio();
    },
  });
  addToggle(panel, {
    label: '🔊 Music',
    value: true,
    onChange: (v) => {
      musicOn = v;
      startAudio();
    },
  });

  // ----- Sound: a little tune that only plays while the tank has music -----
  // Browsers only allow sound after a click, so we start it on the first toggle.
  let audio = null;
  const TUNE = [523, 659, 784, 659, 587, 698, 880, 698, 523, 659, 784, 1047, 988, 784, 659, 587];
  let noteIndex = 0;
  let noteTimer = 0;
  function startAudio() {
    if (!audio) audio = new AudioContext();
    musicOn ? audio.resume() : audio.suspend();
  }
  function playNote(freq) {
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02); // quick fade in
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); // then fade out
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ----- Orbs: the bits of music flying through the air -----
  const orbShape = new THREE.SphereGeometry(0.22, 16, 12);
  const orbs = [];
  function launch(resent) {
    const from = phone.position.clone().setY(1.3);
    const to = headphones.position.clone().setY(1.3);
    const distance = from.distanceTo(to);

    // How likely is this bit to get lost, and why?
    let chance = Math.max(0, (distance - 9) * 0.1); // far away = weaker signal
    let cause = 'far';
    const crossesWall = trouble && (from.x - WALL_X) * (to.x - WALL_X) < 0;
    if (trouble) {
      chance += 0.35;
      cause = 'noise';
    }
    if (crossesWall) chance += 0.25;
    if (fightBack) chance *= 0.4; // dodges the noisy spots
    if (resent) chance *= 0.3; // resent bits take a cleaner route
    const lost = Math.random() < chance;
    if (lost && crossesWall && Math.random() < 0.4) cause = 'wall';

    // Where along the trip it dies (the wall spot, or somewhere in the middle).
    let dieAt = 0.4 + Math.random() * 0.3;
    if (cause === 'wall') dieAt = (WALL_X - from.x) / (to.x - from.x);

    const orb = new THREE.Mesh(orbShape, new THREE.MeshBasicMaterial({ color: resent ? COLORS.resent : COLORS.ok, transparent: true }));
    group.add(orb);
    orbs.push({ orb, from, to, t: 0, speed: 6 / distance, lost, cause, dieAt, resent, popping: 0 });
  }

  let tankLevel = TANK_MAX / 2;
  let stuttering = false;
  let sendTimer = 0;
  let clock = 0;

  return {
    update(dt) {
      clock += dt;

      // Send new bits at a steady rate.
      sendTimer += dt;
      while (sendTimer > 1 / SEND_RATE) {
        sendTimer -= 1 / SEND_RATE;
        launch(false);
      }

      // Move every orb along a little arc.
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i];
        if (o.popping > 0) {
          // A lost bit: pop (grow + fade) or shrink away at the wall.
          o.popping += dt;
          const k = o.popping / 0.8; // takes 0.8 s
          o.orb.scale.setScalar(o.cause === 'wall' ? 1 - k : 1 + k * 2.5);
          o.orb.material.opacity = 1 - k;
          if (k >= 1) {
            group.remove(o.orb);
            o.orb.material.dispose();
            orbs.splice(i, 1);
          }
          continue;
        }
        o.t += o.speed * dt;
        const arc = o.resent ? 2.2 : 0.8; // resent bits hop higher, around the trouble
        o.orb.position.lerpVectors(o.from, o.to, o.t);
        o.orb.position.y += Math.sin(Math.PI * Math.min(o.t, 1)) * arc;

        if (o.lost && o.t >= o.dieAt) {
          o.popping = 0.0001;
          if (o.cause !== 'wall') o.orb.material.color.setHex(COLORS.lost);
          if (fightBack) launch(true); // Bluetooth notices and sends it again
        } else if (o.t >= 1) {
          tankLevel = Math.min(TANK_MAX, tankLevel + 1); // arrived: into the tank
          group.remove(o.orb);
          o.orb.material.dispose();
          orbs.splice(i, 1);
        }
      }

      // The headphones use up saved music as they play it.
      const wasStuttering = stuttering;
      if (!stuttering) {
        tankLevel -= PLAY_RATE * dt;
        if (tankLevel <= 0) {
          tankLevel = 0;
          stuttering = true;
        }
      } else if (tankLevel >= 8) {
        stuttering = false; // enough saved up to play again
      }
      if (stuttering !== wasStuttering) {
        setLabelText(status, stuttering ? '⚠️ Stuttering!' : '🎵 Playing', {
          color: stuttering ? '#d93636' : '#1f9d6b',
          size: 1.1,
        });
      }

      // Draw the tank: the fill grows from the bottom.
      const level = Math.max(0.02, tankLevel / TANK_MAX);
      fill.scale.y = level * 1.9;
      fill.position.y = 2.6 - 0.95 + (level * 1.9) / 2;
      fill.material.color.setHex(level < 0.25 ? COLORS.lost : COLORS.ok);
      headphones.userData.glow.material.color.setHex(stuttering ? COLORS.lost : 0x3fbcb0);

      // Pulse the noise bubbles and wobble the status label when stuttering.
      const pulse = 1 + Math.sin(clock * 6) * 0.08;
      microwave.userData.bubble.scale.setScalar(pulse);
      router.userData.bubble.scale.setScalar(pulse);
      status.position.x = stuttering ? Math.sin(clock * 40) * 0.08 : 0;

      // Music: one note every quarter second, only while not stuttering.
      noteTimer += dt;
      if (noteTimer > 0.25) {
        noteTimer = 0;
        if (audio && musicOn && !stuttering) playNote(TUNE[noteIndex++ % TUNE.length]);
      }
    },

    stop() {
      stops.forEach((s) => s());
      if (audio) audio.close();
      for (const o of orbs) o.orb.material.dispose();
      disposeGroup(group); // also frees orbShape via any orb still in the group
      orbShape.dispose();
    },
  };
}
