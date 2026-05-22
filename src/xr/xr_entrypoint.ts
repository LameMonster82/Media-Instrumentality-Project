import * as THREE from 'three';


export async function initXrLibrary() {
  const width = window.innerWidth, height = window.innerHeight;

  const camera = new THREE.PerspectiveCamera( 70, width / height, 0.01, 10 );
  camera.position.z = 1;

  const scene = new THREE.Scene();

  const geometry = new THREE.BoxGeometry( 0.2, 0.2, 0.2 );
  const material = new THREE.MeshNormalMaterial();

  const mesh = new THREE.Mesh( geometry, material );
  scene.add( mesh );

  const renderer = new THREE.WebGLRenderer( { antialias: true } );
  renderer.setSize( width, height );

  document.body.appendChild( renderer.domElement );
  renderer.render(scene, camera);
}

