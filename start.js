const gameStart = document.getElementById('start-button')
const body = document.body;
let scrollPosition = 0;



gameStart.addEventListener('click', function () {
    window.location.href = './index.html'; // Cambia esto por la ruta correcta
});


function animateBackground() {
    scrollPosition += -0.5; // Ajusta la velocidad de desplazamiento
    body.style.backgroundPosition = `0 ${scrollPosition}px`;
    requestAnimationFrame(animateBackground);
}

animateBackground();