// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Tu configuración de Firebase vinculada a Academic Tracker Pro
const firebaseConfig = {
    apiKey: "AIzaSyCDy-W8_3sB3WS8gVKZuzV_P6PdG1tBOUc",
    authDomain: "academic-tracker-qeoxi.firebaseapp.com",
    projectId: "academic-tracker-qeoxi",
    storageBucket: "academic-tracker-qeoxi.firebasestorage.app",
    messagingSenderId: "674671663079",
    appId: "1:674671663079:web:96e8125d02652b024469e3"
};

// Inicializamos la App y los servicios
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Exportamos para que otros archivos JS puedan usar la base de datos
export { db, storage };
