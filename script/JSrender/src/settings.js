
// Add listeners to all settings
document.addEventListener('DOMContentLoaded', function() {
   var elems = document.querySelectorAll('.setting');
   for (var i = 0; i < elems.length; i++) {
      var elem = elems[i];
      loadSetting(elem);
      
      elem.addEventListener('change', function() {
         if(this.type === 'checkbox') {
            this.value = this.checked;
         }
         localStorage.setItem(this.getAttribute('data-setting'), this.value);

         console.log('Setting ' + this.getAttribute('data-setting') + ' to ' + this.value);
      });
   }
});

function resetSettings() {
   localStorage.clear();
   var elems = document.querySelectorAll('.setting');
   for (var i = 0; i < elems.length; i++) {
      var elem = elems[i];
      if(elem.type === 'radio' || elem.type === 'checkbox') {
         elem.checked = elem.getAttribute('data-default-value') === 'true' ? 'checked' : '';
      } else if(elem.type === 'checkbox') {
         elem.value = elem.getAttribute('data-default-value');
      }
   }
}

function loadSetting(elem) {
   var setting = elem.getAttribute('data-setting');
   var value = localStorage.getItem(setting);
   console.log('Loading setting ' + setting + ' with value ' + value);
   switch (elem.type) {
      case 'radio':
         elem.setAttribute('data-default-value', elem.checked);
         if(value === null) {
            if (elem.checked) {
               localStorage.setItem(setting, elem.value);
            }
            return;
         }
         isChecked = (value === elem.value);
         elem.checked = isChecked ? 'checked' : '';
         break;
      case 'checkbox':
         elem.setAttribute('data-default-value', elem.checked);
         if(value === null) return;
         elem.checked = (value === 'true') ? 'checked' : '';
         break;
      default:
         elem.setAttribute('data-default-value', elem.value);
         if(value === null) return;
         elem.value = value;
         break;
   }
}

/* Set the width of the side navigation to 250px */
function openSettings() {
  document.getElementById("settings-panel").style.width = "800px";
}

/* Set the width of the side navigation to 0 */
function closeSettings() {
  document.getElementById("settings-panel").style.width = "0";
} 