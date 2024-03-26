const gameStart = document.getElementById('start-button')
const body = document.body;
const welcome = document.querySelector('.welcome-screen')
let scrollPosition = 0;




gameStart.addEventListener('click', function () {
    window.location.href = './index.html'; // Cambia esto por la ruta correcta
});



function animateBackground() {
   
    scrollPosition += -1; // Ajusta la velocidad de desplazamiento
    body.style.backgroundPosition = `0 ${scrollPosition}px`;
    requestAnimationFrame(animateBackground);
    setTimeout(()=>{
        scrollPosition = body.style.backgroundPosition;
        welcome.style.display ="block"
       },11000)
      
       
}

animateBackground();


