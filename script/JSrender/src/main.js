var structureLitematic;

function loadAndProcessFile(file) {
   
   if (deepslateResources == null) {return;}

   // Remove input form to stop people submitting twice
   const elem = document.getElementById('file-loader-panel');
   elem.parentNode.removeChild(elem);
      
   let reader = new FileReader();
   reader.readAsArrayBuffer(file);
   reader.onload = function(evt) {

      //var buffer = new Uint8Array(reader.result);
      //console.log(buffer);

      const nbtdata = deepslate.readNbt(new Uint8Array(reader.result));//.result; // Don't care about .compressed
      console.log("Loaded litematic with NBT data:")
      console.log(nbtdata.value);
      structureLitematic = readLitematicFromNBTData(nbtdata);
      
      createRenderCanvas();

      //Create sliders
      const max_y = structureLitematic.regions[0].blocks[0].length;
      createRangeSliders(max_y);

      const blockCounts = getMaterialList(structureLitematic);
      createMaterialsList(blockCounts);

      setStructure(structureFromLitematic(structureLitematic), reset_view=true);

   };
   reader.onerror = function() {
      console.log(reader.error);
   };
   
}

function createMaterialsList(blockCounts) {
   const materialList = document.getElementById('materialList');

   materialList.innerHTML = Object.entries(blockCounts)
    .sort(([,a], [,b]) => b - a)
    .map(([key, val]) => `<div class="count-item"><span>${key.replace('minecraft:', '')}</span><span>${val}</span></div>`)
    //.map(([key, val]) => `<tr><td>${key}</td><td>${val}</td></tr>`)
    .join('');
   materialList.style.display = 'none';

   const materialListButton = document.getElementById('materialListButton');
   materialListButton.style.display = 'block';
   //materialListButton.onmouseover = () => materialList.style.display = 'block';
   //materialListButton.onmouseout = () => materialList.style.display = 'none';

   materialListButton.onclick = () => materialList.style.display = materialList.style.display === 'none' ? 'block' : 'none';

   function downloadMaterialsCSV() {
      const csvContent = Object.entries(blockCounts)
      .sort(([,a], [,b]) => b - a)
      .map(([key, val]) => `${key},${val}`)
      .join('\n');

       const blob = new Blob([csvContent], { type: 'text/csv' });
       const url = window.URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = 'MaterialList.csv';
       a.click();
       window.URL.revokeObjectURL(url);
   }

   // Add download button
   const downloadBtn = document.createElement('button');
   downloadBtn.innerHTML = '<span class="material-icons">download</span>';
   downloadBtn.className = 'material-button';
   downloadBtn.onclick = downloadMaterialsCSV;
   materialList.appendChild(downloadBtn);

}

function createRangeSliders(max_y) {
   const slidersDiv = document.getElementById('sliders');
   slidersDiv.style.display = "block";

   const minSlider = document.createElement('input');
   minSlider.type = 'range';
   minSlider.id = 'miny';
   minSlider.min = 0;
   minSlider.max = max_y;
   minSlider.value = 0;
   minSlider.step = 1;

   const maxSlider = document.createElement('input');
   maxSlider.type = 'range';
   maxSlider.id = 'maxy';
   maxSlider.min = 0;
   maxSlider.max = max_y;
   maxSlider.value = max_y-1;
   maxSlider.step = 1;

   var y_min = 0;
   var y_max = max_y;

   minSlider.addEventListener('change', function(e) {
      y_min = e.target.value;
      console.log(y_min);
      setStructure(structureFromLitematic(structureLitematic, y_min=y_min, y_max=y_max));
   });

   maxSlider.addEventListener('change', function(e) {
      y_max = e.target.value;
      console.log(y_max);
      setStructure(structureFromLitematic(structureLitematic, y_min=y_min, y_max=y_max));
   });

   slidersDiv.appendChild(minSlider);
   slidersDiv.appendChild(maxSlider);
}
