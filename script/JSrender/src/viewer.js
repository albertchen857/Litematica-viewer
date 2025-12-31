const { mat4, vec3 } = glMatrix;
var webglContext;

var deepslateRenderer;

var cameraPitch; // X rotation
var cameraYaw; // Y rotation
var cameraPos;

function setStructure(structure, reset_view=false) {

  // Create Deepslate Renderer
  // Need chunksize 8 as seems to be a max number of faces per chunk that will render
  deepslateRenderer = new deepslate.StructureRenderer(webglContext, structure, deepslateResources, options={chunkSize: 8});

  if (reset_view) {
    cameraPitch = 0.8; cameraYaw = 0.5;
    const size = structure.getSize();
    vec3.set(cameraPos, -size[0] / 2, -size[1] / 2, -size[2] / 2);
  }

  requestAnimationFrame(render);
}

function render() {

  // Clamp / normalise view
  cameraYaw = cameraYaw % (Math.PI * 2);
  cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch));

  const view = mat4.create();
  mat4.rotateX(view, view, cameraPitch);
  mat4.rotateY(view, view, cameraYaw);
  mat4.translate(view, view, cameraPos);

  deepslateRenderer.drawStructure(view);
  deepslateRenderer.drawGrid(view);
}

function createRenderCanvas() {

  // Remove old content
  const oldContent = document.getElementById('main-content');
  oldContent.style.display = "none";

  // Create canvas and size it appropriately
  // TODO: Make size change on window resize
  const viewer = document.getElementById('viewer');
  const canvas = document.createElement('canvas');
  viewer.appendChild(canvas);

  canvas.width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  canvas.height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

  // Get webgl context
  webglContext = canvas.getContext('webgl');


  // Set starting pos
  cameraPitch = 0.8;
  cameraYaw = 0.5;
  cameraPos = vec3.create();

  function move3d(direction, relativeVertical = true, sensitivity = 1) {
    let offset = vec3.create();
    vec3.set(offset,
      direction[0] * sensitivity,
      direction[1] * sensitivity,
      direction[2] * sensitivity);
    if( relativeVertical) {
      vec3.rotateX(offset, offset, [0, 0, 0], -cameraPitch * sensitivity);
    }
    vec3.rotateY(offset, offset, [0, 0, 0], -cameraYaw * sensitivity);
    vec3.add(cameraPos, cameraPos, offset);
  }
  
  function pan(direction, sensitivity = 1) {
    // seems backwards but is correct
    cameraYaw += direction[0] / 200 * sensitivity;
    cameraPitch += direction[1] / 200 * sensitivity;
  }
  
  function move(offset, sensitivity) {
    xOffset = offset[0] / 500 * sensitivity;
    yOffset = offset[1] / 500 * sensitivity;
    let offset_vector = vec3.create();
    vec3.set(offset_vector, xOffset, -yOffset, 0);
    vec3.rotateX(offset_vector, offset_vector, [0, 0, 0], -cameraPitch);
    vec3.rotateY(offset_vector, offset_vector, [0, 0, 0], -cameraYaw);
    vec3.add(cameraPos, cameraPos, offset_vector);
  }

  function runMovementFunction(setting, evt, controls, invertSetting = null, sensitivitySetting = null) {
    
    const value = localStorage.getItem(setting) ?? document.getElementById(setting).value;
    let sensitivity = 1;
    if (sensitivitySetting) {
      sensitivity *= parseFloat(localStorage.getItem(sensitivitySetting) ?? 1);
    }
    if (invertSetting) {
      const invert = localStorage.getItem(invertSetting) === 'true' ?? document.getElementById(invertSetting)?.checked === 'true';
      if (invert) {
        sensitivity *= -1;
      }
    }
    controls[value](evt, sensitivity);
    // controls[value](evt);
  }
  
  let middleClickPos = null;
  let leftPos = null;
  canvas.addEventListener('mousedown', evt => {
    if (evt.button === 0) {
      evt.preventDefault();
      leftPos = [evt.clientX, evt.clientY];
    } else if (evt.button === 1) {
      evt.preventDefault();
      middleClickPos = [evt.clientX, evt.clientY];;
    }
  });
  canvas.addEventListener('mousemove', evt => {
    if (middleClickPos) {
      const args = [
        evt.clientX - middleClickPos[0],
        evt.clientY - middleClickPos[1]
      ]
      runMovementFunction(
        'middle-click-drag',
        args,
        {move, pan},
        'middle-click-drag-invert',
        'middle-click-drag-sensitivity'
      );
      middleClickPos = [evt.clientX, evt.clientY];
      requestAnimationFrame(render);
      
    } else if (leftPos) {
      const args = [
        evt.clientX - leftPos[0],
        evt.clientY - leftPos[1]
      ]
      runMovementFunction('click-drag', args, {move, pan}, 'click-drag-invert', 'click-drag-sensitivity');
      // move([evt.clientX - leftPos[0], evt.clientY - leftPos[1]]);
      leftPos = [evt.clientX, evt.clientY];
      requestAnimationFrame(render);
    }
  });
  canvas.addEventListener('mouseup', evt => {
    if (evt.button === 0) {
      leftPos = null;
    } else if (evt.button === 1) {
      middleClickPos = null;
      evt.preventDefault();
    }
  });
  canvas.addEventListener('mouseout', evt => {
    leftPos = null;
    middleClickPos = null;
    evt.preventDefault();
  });
  canvas.addEventListener('wheel', evt => {
    evt.preventDefault();
    move3d([0, 0, -evt.deltaY / 200]);
    requestAnimationFrame(render);
  });
  
  const moveDist = 0.2;
  const keyMoves = {
    KeyW: [0, 0, moveDist],
    KeyS: [0, 0, -moveDist],
    KeyA: [moveDist, 0, 0],
    KeyD: [-moveDist, 0, 0],
    ArrowUp: [0, 0, moveDist],
    ArrowDown: [0, 0, -moveDist],
    ArrowLeft: [moveDist, 0, 0],
    ArrowRight: [-moveDist, 0, 0],
    ShiftLeft: [0, moveDist, 0],
    Space: [0, -moveDist, 0]
  };
  let pressedKeys = new Set();
  
  document.addEventListener('keydown', evt => {
    if (evt.code in keyMoves) {
      evt.preventDefault();
      pressedKeys.add(evt.code);
    }
  });
  
  document.addEventListener('keyup', evt => {
    pressedKeys.delete(evt.code);
  });

  window.addEventListener('blur', () => pressedKeys.clear());
  
  setInterval(() => {
    if(pressedKeys.size == 0) return;

    let direction = vec3.create();
    for (const key of pressedKeys) {
      vec3.add(direction, direction, keyMoves[key]);
    }
    move3d(direction, false);
    requestAnimationFrame(render);

  }, 1000/60);

  canvas.addEventListener("touchstart", touchHandler);
  canvas.addEventListener("touchmove", touchHandler);
  canvas.addEventListener("touchend", () => {
    middleClickPos = null;
    prevDist = null;
    prevAvgX = null;
    prevAvgY = null;
  });

  const pinchSpeed = 0.015;
  const dragSpeed = 0.01;
  let prevAvgX;
  let prevAvgY;
  let prevDist;
  function touchHandler(evt) {
    evt.preventDefault();
    if(evt.touches.length == 1) {
      if (evt.touches && middleClickPos) {
        const dx = evt.touches[0].pageX - middleClickPos[0]; // x movement
        const dy = evt.touches[0].pageY - middleClickPos[1]; // y movement
        
        pan([dx, dy]);
    
        requestAnimationFrame(render);
      }
      middleClickPos = [evt.touches[0].pageX, evt.touches[0].pageY];

    } else if(evt.touches.length == 2) {

      // Pinch to move forward/backward
      const dx = evt.touches[0].pageX - evt.touches[1].pageX;
      const dy = evt.touches[0].pageY - evt.touches[1].pageY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (!prevDist) prevDist = dist;
      
      // Drag to move left/right/up/down
      const avgX = evt.touches[0].pageX + evt.touches[1].pageX / 2;
      const avgY = evt.touches[0].pageY + evt.touches[1].pageY / 2;
      if (!prevAvgX) prevAvgX = avgX;
      if (!prevAvgY) prevAvgY = avgY;
      const distX = (avgX - prevAvgX) * dragSpeed;
      const distY = (prevAvgY - avgY) * dragSpeed;

      move3d([distX, distY, (dist - prevDist) * pinchSpeed]);
      requestAnimationFrame(render);
      prevDist = dist;
      prevAvgX = avgX;
      prevAvgY = avgY;
    }
  }
}
