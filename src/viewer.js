/* global dat */

const THREE = window.THREE = require('three');
const Stats = require('../lib/stats.min');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

require('../lib/GLTFLoader');

require('three/examples/js/controls/OrbitControls');

const DEFAULT_CAMERA = '[default]';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

module.exports = class Viewer {

  constructor (el, options) {
    this.el = el;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;

    this.state = {
      environment: environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: false,

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      ambientIntensity: 0.3,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8,
      directColor: 0xFFFFFF
    };

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    this.defaultCamera = new THREE.PerspectiveCamera( 60, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.activeCamera = this.defaultCamera;
    this.scene.add( this.defaultCamera );

    this.renderer = window.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.gammaOutput = true;
    //this.renderer.setClearColor( 0xcccccc );
	this.renderer.setClearColor (0xff0000, 1);
	this.renderer.setClearColor( 0xFFFFFF );
	
	
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( el.clientWidth, el.clientHeight );

    this.controls = new THREE.OrbitControls( this.defaultCamera, this.renderer.domElement );
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;

    this.background = createVignetteBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: ['#ffffff', '#353535']
    });

    this.el.appendChild(this.renderer.domElement);

    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];
    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

	
	this.addLights();
    this.addGUI();
    if (options.kiosk) this.gui.close();

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate (time) {

    requestAnimationFrame( this.animate );

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render () {

    this.renderer.render( this.scene, this.activeCamera );

  }

  resize () {

    const {clientHeight, clientWidth} = this.el.parentElement;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.background.style({aspect: this.defaultCamera.aspect});
    this.renderer.setSize(clientWidth, clientHeight);

  }

  load ( url, rootPath, assetMap ) {

    const baseURL = THREE.Loader.prototype.extractUrlBase(url);

    // Load.
    return new Promise((resolve, reject) => {

      const manager = new THREE.LoadingManager();

      // Intercept and override relative URLs.
      manager.setURLModifier((url, path) => {

        const normalizedURL = rootPath + url
          .replace(baseURL, '')
          .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      });

      const loader = new THREE.GLTFLoader(manager);
      loader.setCrossOrigin('anonymous');
      const blobURLs = [];

      loader.load(url, (gltf) => {

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];
        this.setContent(scene, clips);

        blobURLs.forEach(URL.revokeObjectURL);

        resolve();

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   */
  setContent ( object, clips ) {

    this.clear();

    object.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize().length();
    const center = box.getCenter();

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.position.copy(center);
    this.defaultCamera.position.x += size / 2.0;
    this.defaultCamera.position.y += size / 5.0;
    this.defaultCamera.position.z += size / 2.0;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();
    this.defaultCamera.lookAt(center);

    this.setCamera(DEFAULT_CAMERA);

    this.controls.saveState();

    this.scene.add(object);
    this.content = object;

	
	// remove lights if provided in scene
    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.setClips(clips);

    //this.updateLights();
    this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateDisplay();

    window.content = this.content;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    this.printGraph(this.content);

  }

  printGraph (node) {

    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();

  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips ( clips ) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer( this.content );
  }

  playAllClips () {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera ( name ) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding () {
    const encoding = this.state.textureEncoding === 'sRGB'
      ? THREE.sRGBEncoding
      : THREE.LinearEncoding;
    this.content.traverse((node) => {
      if (node.isMesh) {
        const material = node.material;
        if (material.map) material.map.encoding = encoding;
        if (material.emissiveMap) material.emissiveMap.encoding = encoding;
        if (material.map || material.emissiveMap) material.needsUpdate = true;
      }
    });
  }

  updateLights () {
    const state = this.state;
    const lights = this.lights;

    if (state.addLights && !lights.length) {
      this.addLights();
    } else if (!state.addLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMappingExposure = state.exposure;

	
	/*
    if (lights.length) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }*/
  }
  
  
  createAmbientLight() { 
  
		this.mAmbientLight = new THREE.AmbientLight(0xFFFFFF , 0.25 ); // color intensity 
        this.scene.add( this.mAmbientLight );    

        

        this.mHemisphereLight  = new THREE.HemisphereLight( 0xEEEEEC, 0x000023, 0.8 ); // skyColor, groundColor, intensity


        // this.mLight.color.setHSL( 0.0, 0.0, 1.0 );
        // this.mLight.groundColor.setHSL( 0.0, 0.0, 0.1 );
        // this.mLight.position.set( 0, 1000, 5000 );

       this.mHemisphereLight .position.set( 0, 1000, 0 );

        this.scene.add( this.mHemisphereLight  );
  
  }
  
  
  createDirectionalLight() {
	  
		var debugLights = false;
        
        var highQuality = false;
        if( highQuality ) { 
            var SHADOW_MAP_WIDTH = 4096;
            var SHADOW_MAP_HEIGHT = 4096;            
        }else{ 
            var SHADOW_MAP_WIDTH = 2048;
            var SHADOW_MAP_HEIGHT = 2048;        
        }        
        
        
        var distance =  0; // 0: infinite 
        // this.mLight = new THREE.DirectionalLight( 0xffffff, 0.95 ) ;//new THREE.SpotLight( 0xffffff, 1, distance, Math.PI /4  );
        this.mDirectionalLight = new THREE.DirectionalLight( 0xffffff, 0.4 ) ;
        this.mDirectionalLight.position.set( -2500, 3000, 2500 );
        this.mDirectionalLight.target.position.set( 0, 200, 0 );
        // this.mLight.castShadow = true;
        this.mDirectionalLight.castShadow = false;


        this.mDirectionalLight.shadow = new THREE.LightShadow( new THREE.PerspectiveCamera( 90, 1, 1200, 10000 ) );
        this.mDirectionalLight.shadow.bias = 0.0000;//1;
        //Shadow map bias, how much to add or subtract from the normalized depth when deciding whether a surface is in shadow.
        //The default is 0. Very tiny adjustments here (in the order of 0.0001) may help reduce artefacts in shadows  

        this.mDirectionalLight.shadow.radius = 1.5;
        // Setting this this to values greater than 1 will blur the edges of the shadow.
        // High values will cause unwanted banding effects in the shadows - a greater mapSize will allow for a higher value to be used here before these effects become visible.
 
         this.mDirectionalLight.shadow.mapSize.width = SHADOW_MAP_WIDTH;
         this.mDirectionalLight.shadow.mapSize.height = SHADOW_MAP_HEIGHT;
        if( debugLights ){  
            var helper2 = new THREE.CameraHelper(  this.mDirectionalLight.shadow.camera );
             this.scene.add( helper2 );               
        
        } 
     
		this.scene.add( this.mDirectionalLight ); 
	  
	  
	  
  }

  addLights () {
    const state = this.state;
 
		this.createAmbientLight();
		
		this.createDirectionalLight();
         
        
     
  }

  removeLights () {

	/*
    this.lights.forEach((light) => this.defaultCamera.remove(light));
    this.lights.length = 0;*/

  }

  updateEnvironment () {
	  
	  
	  return;

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];
    const {path, format} = environment;

    let envMap = null;
    if (path) {
        envMap = new THREE.CubeTextureLoader().load([
          path + 'posx' + format, path + 'negx' + format,
          path + 'posy' + format, path + 'negy' + format,
          path + 'posz' + format, path + 'negz' + format
        ]);
        envMap.format = THREE.RGBFormat;
    }

    if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
      this.scene.add(this.background);
    } else {
      this.scene.remove(this.background);
    }

    this.content.traverse((node) => {
      if (node.material && 'envMap' in node.material) {
        node.material.envMap = envMap;
        node.material.needsUpdate = true;
      }
    });

    this.scene.background = this.state.background ? envMap : null;

  }

  updateDisplay () {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    this.content.traverse((node) => {
      if (node.isMesh) {
        node.material.wireframe = this.state.wireframe;
      }
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new THREE.GridHelper();
        this.axesHelper = new THREE.AxesHelper();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
      }
    }
  }
  
  
      stringToHex  ( string ) { 
        
        function d2h(d) {
            return d.toString(16);
        }
        
        var str = '',
            i = 0,
            tmp_len = string.length,
            c;
     
        for (; i < tmp_len; i += 1) {
            c = string.charCodeAt(i);
            str += d2h(c) + ' ';
        }
        return str;       
    } 

	
     hexToString  ( hex ) { 
        function h2d (h) {
            return parseInt(h, 16);
        }
        var arr = hex.split(' '),
            str = '',
            i = 0,
            arr_len = arr.length,
            c;
     
        for (; i < arr_len; i += 1) {
            c = String.fromCharCode( h2d( arr[i] ) );
            str += c;
        }
     
        return str;  
} 

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260});

    // Display controls.
    const dispFolder = gui.addFolder('Display');
    const envBackgroundCtrl = dispFolder.add(this.state, 'background');
    envBackgroundCtrl.onChange(() => this.updateEnvironment());
    const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
    wireframeCtrl.onChange(() => this.updateDisplay());
    const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
    skeletonCtrl.onChange(() => this.updateDisplay());
    const gridCtrl = dispFolder.add(this.state, 'grid');
    gridCtrl.onChange(() => this.updateDisplay());
    dispFolder.add(this.controls, 'autoRotate');

    // AMBIENT Lighting controls.
    const lightFolder = gui.addFolder('Ambient Lighting');
 
	// ambient light color
	var params = {color: "#" + this.mAmbientLight.color.getHexString()  };
	lightFolder.addColor( params, 'color').onChange(( colorValue ) => {
		var colorObject = new THREE.Color( colorValue ) ;
		this.mAmbientLight.color = colorObject; 
    });
	
	var params = {intensity:  this.mAmbientLight.intensity   };
	lightFolder.add( params, 'intensity', 0, 1).onChange(( intensity ) => {
		this.mAmbientLight.intensity = intensity; 
    });
	
	
	
    // hemisphereLightFolder Lighting controls.
    const hemisphereLightFolder = gui.addFolder('Hemisphere Lighting');
 
	// sky light color
	var params = {color: "#" + this.mHemisphereLight.color.getHexString()  };
	hemisphereLightFolder.addColor( params, 'color').onChange(( colorValue ) => {
		var colorObject = new THREE.Color( colorValue ) ;
		this.mHemisphereLight.color = colorObject; 
    });
	
	 
	// ground light color
	var params = {groundColor: "#" + this.mHemisphereLight.groundColor.getHexString() };
	hemisphereLightFolder.addColor( params, 'groundColor').onChange(( colorValue ) => {
		var colorObject = new THREE.Color( colorValue ) ;
		this.mHemisphereLight.groundColor = colorObject; 
    });	
	
	
	var params = {intensity: this.mHemisphereLight.intensity   };
	hemisphereLightFolder.add( params, 'intensity', 0, 1).onChange(( intensity ) => {
		this.mHemisphereLight.intensity = intensity; 
    });
	
	
	
    const DirectionalLightFolder = gui.addFolder('Directional Lighting');
 
	// ambient light color
	var params = {color: "#" + this.mDirectionalLight.color.getHexString()  };
	DirectionalLightFolder.addColor( params, 'color').onChange(( colorValue ) => {
		var colorObject = new THREE.Color( colorValue ) ;
		this.mDirectionalLight.color = colorObject; 
    });
	
	var params = {intensity:  this.mDirectionalLight.intensity   };
	DirectionalLightFolder.add( params, 'intensity', 0, 1).onChange(( intensity ) => {
		this.mDirectionalLight.intensity = intensity; 
    });
	
	
	
	 

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
    playbackSpeedCtrl.onChange((speed) => {
      if (this.mixer) this.mixer.timeScale = speed;
    });
    this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

    // Morph target controls.
    this.morphFolder = gui.addFolder('Morph Targets');
    this.morphFolder.domElement.style.display = 'none';

    // Camera controls.
    this.cameraFolder = gui.addFolder('Cameras');
    this.cameraFolder.domElement.style.display = 'none';

    // Stats.
    const perfFolder = gui.addFolder('Performance');
    const perfLi = document.createElement('li');
    this.stats.dom.style.position = 'static';
    perfLi.appendChild(this.stats.dom);
    perfLi.classList.add('gui-stats');
    perfFolder.__ul.appendChild( perfLi );

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();

  }

  updateGUI () {
    this.cameraFolder.domElement.style.display = 'none';

    this.morphCtrls.forEach((ctrl) => ctrl.remove());
    this.morphCtrls.length = 0;
    this.morphFolder.domElement.style.display = 'none';

    this.animCtrls.forEach((ctrl) => ctrl.remove());
    this.animCtrls.length = 0;
    this.animFolder.domElement.style.display = 'none';

    const cameraNames = [];
    const morphMeshes = [];
    this.content.traverse((node) => {
      if (node.isMesh && node.morphTargetInfluences) {
        morphMeshes.push(node);
      }
      if (node.isCamera) {
        node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
        cameraNames.push(node.name);
      }
    });

    if (cameraNames.length) {
      this.cameraFolder.domElement.style.display = '';
      if (this.cameraCtrl) this.cameraCtrl.remove();
      const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
      this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
      this.cameraCtrl.onChange((name) => this.setCamera(name));
    }

    if (morphMeshes.length) {
      this.morphFolder.domElement.style.display = '';
      morphMeshes.forEach((mesh) => {
        if (mesh.morphTargetInfluences.length) {
          const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
          this.morphCtrls.push(nameCtrl);
        }
        for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
          const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1).listen();
          this.morphCtrls.push(ctrl);
        }
      });
    }

    if (this.clips.length) {
      this.animFolder.domElement.style.display = '';
      const actionStates = this.state.actionStates = {};
      this.clips.forEach((clip, clipIndex) => {
        // Autoplay the first clip.
        let action;
        if (clipIndex === 0) {
          actionStates[clip.name] = true;
          action = this.mixer.clipAction(clip);
          action.play();
        } else {
          actionStates[clip.name] = false;
        }

        // Play other clips when enabled.
        const ctrl = this.animFolder.add(actionStates, clip.name).listen();
        ctrl.onChange((playAnimation) => {
          action = action || this.mixer.clipAction(clip);
          action.setEffectiveTimeScale(1);
          playAnimation ? action.play() : action.stop();
        });
        this.animCtrls.push(ctrl);
      });
    }
  }

  clear () {

    this.scene.remove( this.content );

  }

};
