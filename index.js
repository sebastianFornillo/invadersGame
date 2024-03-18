const canvas = document.querySelector('canvas')
const score = document.querySelector('#scoreElement')
const c = canvas.getContext('2d')
 const point = document.querySelector('.point') 
const div = document.querySelector('.di')
const span = document.querySelector('span')



canvas.width = 1024
canvas.height = 576
console.log(c);

//clase jugador 
class Player {
    constructor(){
        
        this.velocity={
            x:0,
            y:0
    }
    this.rotation=0
    this.opacity = 1

    const image = new Image()
        image.src="./img/spaceship.png"
        image.onload = () => {
        const escala = 0.20
        this.image = image
        this.width = image.width * escala
        this.height= image.height * escala

        this.position={
            x: canvas.width /2  - this.width /2 ,
            y:canvas.height - this.height - 20
        }
        }
    }
    draw(){
       /*  c.fillStyle = "red"
        c.fillRect(this.position.x, this.position.y,this.width, this.height) */
        c.save()
        c.globalAlpha = this.opacity
        c.translate(player.position.x + player.width /2 , player.position.y + player.height /2)
        c.rotate(this.rotation)
        c.translate(-player.position.x - player.width /2 , -player.position.y - player.height /2)
        c.drawImage(
       this.image, 
       this.position.x,
       this.position.y,
       this.width,
       this.height)
       c.restore()

    }  
    update(){
        if(this.image){
        this.draw()
        this.position.x += this.velocity.x
    }
}
}
// clase projectil nave 
class Projectile {
    constructor({ position , velocity}){

        this.position = position
        this.velocity = velocity
        this.radius = 4
    }

    draw(){

        c.beginPath()
        c.arc(this.position.x, this.position.y, this.radius, 0 , Math.PI * 2)
        c.fillStyle = 'red'
        c.fill()
        c.closePath()
    }

    update(){
        this.draw()
        this.position.x += this.velocity.x
        this.position.y += this.velocity.y
    }
}

//particula explosiva
class Particle {
    constructor({ position , velocity , radius , color , fades}){

        this.position = position
        this.velocity = velocity
        this.radius = radius
        this.color = color 
        this.opacity = 1
        this.fades = fades
    }

    draw(){
        c.save()
        c.globalAlpha = this.opacity
        c.beginPath()
        c.arc(this.position.x, this.position.y, this.radius, 0 , Math.PI * 2)
        c.fillStyle = this.color
        c.fill()
        c.closePath()
        c.restore()
    }

    update(){
        this.draw()
        this.position.x += this.velocity.x
        this.position.y += this.velocity.y
        if(this.fades)
        this.opacity -= 0.01
    }
}

//clase projectil invasor 
class InvaderProjectile {
    constructor({ position , velocity}){

        this.position = position
        this.velocity = velocity
        
        this.width = 3
        this.height = 10
    }

    draw(){
        c.fillStyle = 'white'
        c.fillRect(this.position.x , this.position.y, this.width, this.height)
    }

    update(){
        this.draw()
        this.position.x += this.velocity.x
        this.position.y += this.velocity.y
    }
}

// clase enemigo invasor
class Invader {
    constructor({position}){
        
        this.velocity={
            x:0,
            y:0
    }

    const image = new Image()
        image.src="./img/invader.png"
        image.onload = () => {
        const escala = 1
        this.image = image
        this.width = image.width * escala
        this.height= image.height * escala

        this.position={
            x: position.x,
            y:position.y
        }
        }
    }
    draw(){
       /*  c.fillStyle = "red"
        c.fillRect(this.position.x, this.position.y,this.width, this.height) */
        
        c.drawImage(
       this.image, 
       this.position.x,
       this.position.y,
       this.width,
       this.height)
      

    }  
    update({velocity}){
        if(this.image){
        this.draw()
        this.position.x += velocity.x
        this.position.y += velocity.y
    }
}
shoot(invaderProjectile){
    invaderProjectile.push(new InvaderProjectile({
        position :{
            x: this.position.x + this.width /2,
            y: this.position.y + this.height
        },
        velocity :{
            x: 0,
            y: 5
            }
        }))
    }
}
//clase grilla de enemigo
class Grid {
    constructor(){
        this.position = {
            x: 0,
            y: 0
        }
        this.velocity = {
            x: 6,
            y: 0
        }
        this.invaders = []
        const column = Math.floor(Math.random() * 10 + 5 )
        const rows = Math.floor(Math.random() * 5 + 2 )
        this.width = column * 30

        for(let x = 0 ; x < column ; x++){
            for(let y = 0 ; y < rows ; y++){

        this.invaders.push(new Invader({position:{
                x: x * 30,
                y: y * 30
            }}))
        }
    }}
    update(){
        this.position.x += this.velocity.x
        this.position.y += this.velocity.y
        this.velocity.y = 0

        if(this.position.x + this.width >= canvas.width || this.position.x <= 0){
            this.velocity.x = -this.velocity.x
            this.velocity.y = 30
        }
    }
}

const player = new Player()
const projectiles = []
const grids = [];
const invaderProjectiles =[]
const particles = []

const keys = {
    a:{
        pressed : false
    },
    d:{
        pressed : false
    },
    space:{
        pressed : false
    }
}

let frames = 0
let ramdomIntervalo = Math.floor((Math.random() * 500) + 500)
let puntuacion = 0
let game = {
    over: false ,
    active: true
}

//nieve background

for(let i = 0; i < 115; i++){ 
    particles.push(new Particle({
        position :{
        x : Math.random() * canvas.width,
        y: Math.random() *canvas.height
        },
        velocity :{
            x:0,
            y:0.3
        },
        radius :Math.random() * 3,
        color: 'white'
    }))
}

function createParticle({object, color, fades}){
    for(let i = 0; i < 15; i++){ 
        particles.push(new Particle({
            position :{
            x : object.position.x + object.width / 2,
            y: object.position.y + object.height / 2
            },
            velocity :{
                x:(Math.random()- 0.5) * 2,
                y:(Math.random()- 0.5) * 2
            },
            radius :Math.random()* 1.8,
            color: color || '#BAA0DE',
            fades:fades
        }))
        }

}

function animate() {
    if(!game.active) return
    requestAnimationFrame(animate)
    c.fillStyle = "black"
    c.fillRect(0 , 0 , canvas.width, canvas.height)
    player.update()
    particles.forEach((particle, index) =>{
        if(particle.position.y - particle.radius >= canvas.height){
            particle.position.x = Math.random() * canvas.width  
            particle.position.y = -particle.radius 
        }

        if(particle.opacity <=0){
            setTimeout(()=>{
            particles.splice(index, 1)
            },0)
        }else{
            particle.update()
        }
    })

    invaderProjectiles.forEach((invaderProjectile, index) =>{
    if(invaderProjectile.position.y + invaderProjectile.height >= canvas.height){
        setTimeout(()=>{
            invaderProjectiles.splice(index , 1)
           }, 0)
    }else
        invaderProjectile.update()
    
        //impacto proyectil y jugador 
    if(invaderProjectile.position.y + invaderProjectile.height >= player.position.y &&
        invaderProjectile.position.x + invaderProjectile.width >= player.position.x &&
        invaderProjectile.position.x <= player.position.x + player.width){
          
            setTimeout(()=>{
                invaderProjectiles.splice(index , 1)
               player.opacity = 0
               game.over= true
               
               }, 0)

               setTimeout(()=>{
                invaderProjectiles.splice(index , 1)
                game.active = false
                
               }, 2000)
               setTimeout(()=>{
                canvas.style.display ="none";
                span.textContent = "Game Over";
                span.style.color = "#5dc1b9";
                span.style.fontWeight = "700";
                span.style.fontSize = "38px";
                span.style.fontFamily="scrubble";
                score.style.fontSize = "54px";
                point.innerHTML += `<p>${"Points"}</p>`;
                point.innerHTML += `<button class ="btn">${"Restart"}</button>`;
                let btn = document.querySelector('.btn');
                btn.style.backgroundImage= `url("./img/button.png")`;
                btn.style.backgroundSize = "cover";
                btn.style.color ="white";
                btn.style.fontWeight ="700";
                btn.style.fontSize = "16px";
                btn.style.borderRadius = "15px";
                btn.style.padding = "16px 50px";
                point.style.width = "300px";
                point.style.transform = "translate(-50% , -50%)";
                
               }, 4000)

            createParticle({
                object: player,
                color: 'white',
                fades : true
            })
            
    }
    
})
    projectiles.forEach((projectile , index) =>{
    if(projectile.position.y + projectile.radius <= 0){
       setTimeout(()=>{
        projectiles.splice(index , 1)
       }, 0)
    }else{
        projectile.update()
    }
    })

    grids.forEach((grid , gridIndex) =>{
        grid.update()
        //spawn projectiles 

        if(frames % 100 === 0 && grid.invaders.length > 0){
            grid.invaders[Math.floor(Math.random() * grid.invaders.length)].shoot(invaderProjectiles)
    }

        grid.invaders.forEach((invader , index) =>{
            invader.update({velocity: grid.velocity})

           //projectile hit enemy

            projectiles.forEach((projectile , i) => {
                if(
                    projectile.position.y - projectile.radius <= invader.position.y + invader.height && 
                    projectile.position.x + projectile.radius >= invader.position.x && 
                    projectile.position.x - projectile.radius <= invader.position.x + invader.width && 
                    projectile.position.y + projectile.radius >= invader.position.y ){
                
                        setTimeout(()=>{
                        const invaderFound = grid.invaders.find((invader2) => 
                            invader2 === invader)
                        const projectileFound = projectiles.find((projectile2)=>
                            projectile2 === projectile) 
                        
                            // elimina enemigo y projectiles

                        if(invaderFound && projectileFound){
                            puntuacion +=100
                            score.innerHTML = puntuacion
                        createParticle({
                            object: invader,
                            fades:true
                        })
                            grid.invaders.splice(index, 1)
                        projectiles.splice(i, 1)

                        if(grid.invaders.length > 0){
                            const firtsInvader = grid.invaders[0]
                            const lastInvader = grid.invaders[grid.invaders.length - 1]

                            grid.width = lastInvader.position.x - firtsInvader.position.x + lastInvader.width
                            grid.position.x = firtsInvader.position.x

                        }else{ grids.splice(gridIndex , 1)
                    
                            }
                        }
                    }, 0)
                }
            })
        })
    })

    if(keys.a.pressed && player.position.x >=0){
        player.velocity.x = -8
        player.rotation = -0.15
    }else if(keys.d.pressed && player.position.x + player.width <= canvas.width ){
        player.velocity.x = 8
        player.rotation = 0.15
    }else{
        player.velocity.x = 0
        player.rotation = 0
    }
    //spawnins enemies
    if(frames % ramdomIntervalo === 0){
        grids.push(new Grid())
        ramdomIntervalo = Math.floor((Math.random() * 500) + 800)
        frames = 0  
    }

    frames++
    }
    
    animate() 

    addEventListener('keydown', ({ key }) =>{
        
        if(game.over) return 

        switch(key){
            case 'ArrowLeft':
           /*  console.log("izquierda") */
            keys.a.pressed = true
            break
            case 'ArrowRight':
           /*  console.log("derecha") */
            keys.d.pressed = true
            break
            case ' ':
        
            projectiles.push(new Projectile({
                position:{
                    x: player.position.x + player.width /2 ,
                    y:player.position.y
                },
                velocity:{
                    x:0,
                    y:-15
            
                }
            
            }))
           /*  console.log(projectiles) */
            keys.space.pressed = true
            break
        }


    })

    addEventListener('keyup', ({ key }) =>{
        
        switch(key){
            case 'ArrowLeft':
           /*  console.log("izquierda") */
            keys.a.pressed = false
            break
            case 'ArrowRight':
           /*  console.log("derecha") */
            keys.d.pressed = false
            break
            case ' ':
           /*  console.log("space") */
            keys.space.pressed = false
            break
        }


    })