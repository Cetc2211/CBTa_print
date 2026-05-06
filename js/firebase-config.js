import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCDy-W8_3sB3WS8gVKZuzV_P6PdG1tBOUc",
    authDomain: "academic-tracker-qeoxi.firebaseapp.com",
    projectId: "academic-tracker-qeoxi",
    storageBucket: "academic-tracker-qeoxi.firebasestorage.app",
    messagingSenderId: "674671663079",
    appId: "1:674671663079:web:96e8125d02652b024469e3"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export { firebaseConfig };
