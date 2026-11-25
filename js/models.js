// models.js: simple 3D models built from basic shapes (boxes, rings, spheres).

/*
 * ===========================================================================
 *  models.js  -  THE 3D TOY BOX
 * ===========================================================================
 *
 *  WHAT THIS FILE DOES
 *  -------------------
 *  We don't load any 3D model files. Every gadget (phone, headphones, watch,
 *  speaker, light bulb) is built out of simple shapes: boxes, cylinders,
 *  spheres, rings and donuts (tori), stuck together in a group. This file
 *  also makes:
 *    - text labels that float in 3D and always face the camera (sprites)
 *    - the round glassy floor with distance rings every 5 metres
 *    - disposeGroup(), which deletes a model and frees its graphics memory
 *
 *  HOW IT FITS WITH THE OTHER FILES
 *  --------------------------------
 *  Step files (js/steps/*.js) import these functions, e.g.
 *    const phone = makePhone(); world.scene.add(phone);
 *  and when the step ends they call disposeGroup(...) to clean up.
 *  It does not call any other file of ours; it only uses Three.js.
 *
 *  KEY THREE.JS IDEAS USED HERE
 *  ----------------------------
 *  - Mesh = Geometry + Material.
 *      Geometry: the SHAPE (the corner points and triangles), e.g.
 *        BoxGeometry(width, height, depth), CylinderGeometry(radiusTop,
 *        radiusBottom, height, segments), SphereGeometry(radius, ...),
 *        TorusGeometry (a donut), RingGeometry (a flat washer),
 *        PlaneGeometry / CircleGeometry (flat rectangle / disc).
 *        "segments" = how many flat faces approximate a curve; more = smoother.
 *      Material: the SURFACE (colour, shininess, see-through-ness), e.g.
 *        MeshBasicMaterial (flat colour, ignores lights),
 *        MeshStandardMaterial (reacts to lights),
 *        MeshPhysicalMaterial (like Standard plus extras such as clearcoat).
 *  - Group: an invisible container. Moving/rotating the group moves all of
 *    its children together, so a "phone" can be one thing to drag.
 *  - position / rotation / scale: every object has these. Positions are in
 *    metres, with y pointing UP. Rotations are in radians (Math.PI = 180°).
 *    A child's position is measured from its parent group's centre.
 *  - userData: a free "pocket" on every object where we can stash our own
 *    things (here: a reference to the glow ring, so steps can fade it).
 *  - Sprite: a flat picture that always turns to face the camera.
 *    CanvasTexture: turns a 2D <canvas> drawing into an image the GPU can use.
 *  - dispose(): the graphics card (GPU) keeps its own copy of geometries,
 *    materials and textures. Removing an object from the scene does NOT
 *    free that memory; we must call .dispose() on each one ourselves,
 *    otherwise switching steps again and again would slowly leak memory.
 *  - Colours are hex numbers 0xRRGGBB (like CSS #RRGGBB).
 * ===========================================================================
 */

// Import the whole Three.js library as THREE.
import * as THREE from 'three';

// A shiny "glassy" material we reuse for objects.
/**
 * glassMaterial(color, opacity = 1)
 * color:   a hex colour like 0x6d4ff0.
 * opacity: 1 = solid, 0 = invisible (default 1).
 * Returns a new MeshPhysicalMaterial that looks like glossy plastic/glass.
 */
export function glassMaterial(color, opacity = 1) {
  return new THREE.MeshPhysicalMaterial({
    color, // shorthand for color: color
    roughness: 0.15, // 0 = mirror-smooth, 1 = chalky; low = shiny highlights
    metalness: 0.05, // almost not metal at all
    clearcoat: 1, // an extra glossy varnish layer on top (like a car's paint)
    clearcoatRoughness: 0.1, // that varnish is very smooth
    transparent: opacity < 1, // only turn on see-through mode if we actually need it
    opacity, // how solid it is
  });
}

// A phone: a rounded-looking slab with a glowing screen, standing upright.
// Returns a Group the step can add to the scene and move around.
export function makePhone() {
  const phone = new THREE.Group(); // invisible container for the parts

  // The body: a thin purple box 0.75 wide, 1.5 tall, 0.12 deep (metres).
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.5, 0.12), glassMaterial(0x6d4ff0));
  body.position.y = 0.95; // lift it so it stands on the stand instead of sinking into the floor
  phone.add(body); // make it a child of the group

  // The screen: a flat rectangle with a light lilac colour.
  // MeshBasicMaterial ignores lights, so it looks like it is glowing.
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 1.3),
    new THREE.MeshBasicMaterial({ color: 0xcfc2ff })
  );
  // Same height as the body, pushed forward (z) just past the body's front face.
  screen.position.set(0, 0.95, 0.065);
  phone.add(screen);

  // A short white cylinder as a stand (top radius 0.5, bottom 0.6, height 0.2, 32 sides).
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 32), glassMaterial(0xffffff));
  stand.position.y = 0.1; // half its height, so its bottom sits exactly on the floor
  phone.add(stand);

  return phone;
}

// Headphones: a curved band (half a donut) and two ear cups.
// color has a default (teal) used if the step doesn't pass one.
export function makeHeadphones(color = 0x3fbcb0) {
  const headphones = new THREE.Group();
  const material = glassMaterial(color); // one material shared by band and cups

  // TorusGeometry(radius, tube thickness, tube segments, ring segments, arc).
  // arc = Math.PI = only half the donut, which makes an arch shape.
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 16, 40, Math.PI), material);
  band.position.y = 0.95;
  headphones.add(band);

  // Make two ear cups: side = -1 (left) then side = 1 (right).
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 32), material);
    cup.rotation.z = Math.PI / 2; // turn the cylinder 90° so it lies on its side, facing outwards
    cup.position.set(side * 0.55, 0.9, 0); // place it at the end of the band
    headphones.add(cup);
  }

  // The same white stand as the phone.
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 32), glassMaterial(0xffffff));
  stand.position.y = 0.1;
  headphones.add(stand);

  // A soft glowing ring on the floor, so people can see it is draggable.
  // RingGeometry(inner radius, outer radius, segments) is a flat washer shape.
  // DoubleSide = visible from above and below (flat shapes are one-sided by default).
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.85, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  glow.rotation.x = -Math.PI / 2; // flat shapes start standing up; tip it -90° to lie on the floor
  glow.position.y = 0.01; // a hair above the floor so they don't flicker by fighting over the same height
  headphones.add(glow);
  headphones.userData.glow = glow; // stash it so steps can find it (e.g. to pulse or recolour it)

  return headphones;
}

// Adds a white stand and a glowing floor ring (shows it can be dragged).
// A shared helper (not exported) used by the watch, speaker and bulb below,
// so we don't repeat the same code three times. Returns the same gadget.
function addStandAndGlow(gadget, color) {
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 32), glassMaterial(0xffffff));
  stand.position.y = 0.1; // sits on the floor
  gadget.add(stand);

  // Same glowing floor ring as the headphones, in the gadget's colour.
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.85, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  glow.rotation.x = -Math.PI / 2; // lie flat
  glow.position.y = 0.01; // just above the floor
  gadget.add(glow);
  gadget.userData.glow = glow; // let steps find the ring later
  return gadget;
}

// A smartwatch: a strap (ring) with a square face.
export function makeWatch(color = 0xf27bb0) {
  const watch = new THREE.Group();
  // A full donut standing upright = the strap loop.
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.09, 16, 40), glassMaterial(color));
  strap.position.y = 0.75;
  watch.add(strap);
  // A dark box on the front of the loop = the watch face.
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.18), glassMaterial(0x1c1a24));
  face.position.set(0, 0.75, 0.42); // z = 0.42 puts it on the front edge of the strap
  watch.add(face);
  return addStandAndGlow(watch, color); // add stand + glow ring, then return the group
}

// A speaker: a short fat cylinder with a darker grille.
export function makeSpeaker(color = 0x8b6cf6) {
  const speaker = new THREE.Group();
  // The main body: a cylinder 1.1 tall.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 32), glassMaterial(color));
  body.position.y = 0.75;
  speaker.add(body);
  // A very thin white disc on top (the "grille").
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 32), glassMaterial(0xffffff));
  top.position.y = 1.31; // body centre 0.75 + half its height 0.55 = 1.30, plus a tiny bit
  speaker.add(top);
  return addStandAndGlow(speaker, color);
}

// A smart light bulb: a glowing sphere on a base.
export function makeBulb(color = 0xf5c542) {
  const bulb = new THREE.Group();
  // SphereGeometry(radius, width segments, height segments).
  // emissive = light the surface gives off by itself, so it glows even in shadow.
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: color, emissiveIntensity: 0.6 })
  );
  glass.position.y = 0.95;
  bulb.add(glass);
  // A tapered grey cylinder below = the screw base (wider at the top: 0.2 vs 0.15).
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 24), glassMaterial(0xcfcfd8));
  base.position.y = 0.45;
  bulb.add(base);
  return addStandAndGlow(bulb, color);
}

// A flat text label that always faces the camera (a "sprite").
// We draw the text onto a hidden canvas, then use it as a picture.
/**
 * makeLabel(text, options)
 * text:  the words to show.
 * options (optional): color = CSS text colour (default near-black),
 *                     size  = how big (1 = normal, 2 = twice as tall).
 * Returns a THREE.Sprite the step can position above a gadget.
 */
export function makeLabel(text, { color = '#1c1a24', size = 1 } = {}) {
  // A <canvas> made in memory only: it is never added to the page.
  const canvas = document.createElement('canvas');
  // The 2D drawing "context": the object with the drawing commands (fillText, fill, ...).
  const ctx = canvas.getContext('2d');
  // CSS-style font: weight 600 (semi-bold), 48 pixels, our web font with fallbacks.
  const font = '600 48px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.font = font;
  // Make the canvas just wide enough for the text, plus 24px padding on each side.
  canvas.width = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.height = 80;

  // glass pill background
  // (A see-through white rounded rectangle; radius 40 = fully round ends.)
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 40);
  ctx.fill();

  // Changing the canvas size wipes its settings, so set the font again.
  ctx.font = font;
  ctx.fillStyle = color; // text colour
  ctx.textBaseline = 'middle'; // y below means the vertical middle of the letters
  ctx.fillText(text, 24, 42); // draw the text 24px from the left, centred vertically

  // Turn the canvas drawing into a texture (an image the GPU can paint onto shapes).
  const texture = new THREE.CanvasTexture(canvas);
  // Tell Three.js the colours are normal screen (sRGB) colours, so they don't look washed out.
  texture.colorSpace = THREE.SRGBColorSpace;
  // depthTest: false = always draw on top, never hidden behind 3D objects.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  const height = 0.5 * size; // label height in metres
  // Keep the canvas's width:height shape so the text isn't squashed.
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.renderOrder = 10; // draw after (on top of) normal objects, which have renderOrder 0
  return sprite;
}

// Change what a label says (and its colour) after it was made, e.g. a live
// "🎵 Playing" / "🔇 Lost" sign floating over the headphones.
// We make a fresh label and steal its picture, then throw the rest away.
export function setLabelText(sprite, text, { color, size = 1 } = {}) {
  const fresh = makeLabel(text, { color, size });
  sprite.material.map.dispose(); // free the old picture
  sprite.material.map = fresh.material.map;
  sprite.scale.copy(fresh.scale); // new text may be wider or narrower
  fresh.material.dispose();
}

// Remove a group from the scene and free its memory.
// Steps call this in their stop() function for each thing they created.
export function disposeGroup(group) {
  group.removeFromParent(); // take it out of the scene (it disappears)
  // traverse visits the group itself and every child, grandchild, etc.
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose(); // free the shape data on the GPU
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose(); // free a texture (e.g. a label's picture)
      obj.material.dispose(); // free the material
    }
  });
}

// A round glassy floor with faint rings every 5 metres.
// radius: how big the floor is (default 22 metres).
export function makeFloor(radius = 22) {
  const floor = new THREE.Group();

  // The disc: a flat circle with 96 segments (smooth edge), white and 35% visible.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
  );
  disc.rotation.x = -Math.PI / 2; // tip it over to lie flat on the ground
  floor.add(disc);

  // Thin purple rings at 5, 10, 15 and 20 metres, to help judge distance.
  for (let r = 5; r < radius; r += 5) {
    // A very thin washer: from r - 0.03 to r + 0.03 = 6 cm wide line.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.03, r + 0.03, 128),
      new THREE.MeshBasicMaterial({ color: 0x8b6cf6, transparent: true, opacity: 0.25 })
    );
    ring.rotation.x = -Math.PI / 2; // lie flat
    ring.position.y = 0.005; // a tiny bit above the disc so it isn't hidden by it
    floor.add(ring);
  }

  return floor;
}
