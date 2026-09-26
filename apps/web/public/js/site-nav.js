(function(){
  var menus=[].slice.call(document.querySelectorAll('.adnav-menu'));
  function set(menu,open){
    menu.classList.toggle('adnav-open',open);
    menu.querySelector('.adnav-trigger').setAttribute('aria-expanded',open?'true':'false');
  }
  menus.forEach(function(menu){
    menu.querySelector('.adnav-trigger').addEventListener('click',function(e){
      e.stopPropagation();
      var open=!menu.classList.contains('adnav-open');
      menus.forEach(function(m){set(m,false)});
      set(menu,open);
    });
  });
  document.addEventListener('click',function(e){
    menus.forEach(function(m){if(!m.contains(e.target))set(m,false)});
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape')menus.forEach(function(m){set(m,false)});
  });
})();
