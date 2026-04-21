<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyB1Nrl8x_wJqBzy1uzqLGOdM243h8Dw6Fw",
    authDomain: "appttour.firebaseapp.com",
    projectId: "appttour",
    storageBucket: "appttour.firebasestorage.app",
    messagingSenderId: "298018962537",
    appId: "1:298018962537:web:88606ac251f2d7b904f6f8",
    measurementId: "G-E1L3YDJEMS"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>