function setupPostHandling() {

  var context = window["gh-weblog"],
      entriesDiv = document.querySelector("#gh-weblog-container .entries"),
      github,
      repo,
      branch,
      cacheDelay = 5000,
      cfnGenerator = function(uid) {
        var d = new Date(uid ? uid : Date.now()),
            components = [
              d.getFullYear(),
              d.getMonth() + 1,
              d.getDate(),
              d.getHours(),
              d.getMinutes(),
              d.getSeconds()
            ];
        components = components.map(function(v) {
          return (v < 10 ? "0" + v : v);
        });
        return components.join("-") + ".json";
      };


  entriesDiv.prependChild = function(element) {
    if(entriesDiv.children.length === 0) {
      entriesDiv.appendChild(element);
    } else {
      entriesDiv.insertBefore(element, entriesDiv.children[0]);
    }
  }

  // admin functions
  var show   = function(e) { e.classList.remove("hidden"); }
  var hide   = function(e) { e.classList.add("hidden"); }
  var remove = function(e) { e.parentNode.removeChild(e); }

  /**
   *
   */
  context.parseEntry = function parseEntry(entry) {
    //console.log("parse entry " + entry.id);
    var content = entry.querySelector(".content"),
        ocontent = entry.querySelector(".original.content");
    content.innerHTML = marked(ocontent.textContent);
  };

  /**
   *
   */
  context.addEntry = function addEntry(uid, entryObject) {
    var newEntry = (arguments.length === 0);

    uid = uid || Date.now();
    //console.log("new entry " + uid);

    // set up entry object
    var entryObject = entryObject || {
      title: "",
      author: context.username,
      content: "#New Entry\nclick the entry to start typing",
      tags: ['no tags yet'],
      published: uid,
      updated: uid,
      pending: true
    };
    context.entries[""+uid] = entryObject;

    // add to page
    try {
      nunjucksEnv.render("entry.html", entryObject, function(err, result) {
        if(err) { return console.error("Nunjucks render error", err); }

        var _ = document.createElement("div");
        _.innerHTML = result;
        var element = _.children[0];
        if (newEntry) { entriesDiv.prependChild(element); }
        else { entriesDiv.appendChild(element); }
        context.parseEntry(element);
        context.processors.forEach(function(fn) { fn(element); });

        // on click: edit! if you then click somewhere on the document, update!
        var updateHandler = function(evt) {
          evt.stopPropagation();
          var textarea = element.querySelector("textarea");
          if(evt.target !== textarea) {
            context.updateEntry(uid, textarea);
            document.removeEventListener("click", updateHandler);
          }
        };

        var editHandler = function(evt) {
          evt.stopPropagation();
          context.editEntry(uid);
          document.addEventListener("click", updateHandler);
        };

        element.addEventListener("click", editHandler);

        // Do we need to scrollTo?
        var l = window.location.toString(),
            pos = l.lastIndexOf("#");
        if(pos > -1) {
          var fragment = l.substring(pos);
          if (fragment.length > 2) {
            window.location = fragment;
          }
        }

        // can we bind tag-editing?
        var tagsdiv = element.querySelector(".tags")
        tagsdiv.addEventListener("click", function(evt) {
          var input = prompt("Specify tags (comma separated):", entryObject.tags.join(", "));
          if(!input) return;
          entryObject.tags = input.split(",").map(function(v) { return v.trim(); });
          context.updateEntry(uid);
          tagsdiv.innerHTML = entryObject.tags.join(",");
        });

      });
    } catch (e) { return console.error("Nunjucks error", e); }
  };

  function cancel(evt) {
    evt.preventDefault();
    return false;
  }

  function dropHandler(evt) {
    cancel(evt);
    for (var files = evt.dataTransfer.files, i=0; i<files.length; i++) {
      var file = files[i];
      var reader = new FileReader();
      var name = prompt("image name?");
      reader.addEventListener('loadend', function(e, file) {
        var data = this.result;
        var path = context.path + 'images/' + name;
        var pos = data.indexOf("base64,") + "base64,".length;
        var binaryData = atob(data.substring(pos));
        var commitMsg = "image upload [" + name + "]";
        var isBinary = true;
        branch.write(path, binaryData, commitMsg, isBinary)
              .then(function() {
                prompt("Your image url is:", '<img src="'+path+'">');
              });
      });
      reader.readAsDataURL(file);
    }
    return false;
  }

  /**
   *
   */
  context.editEntry = function editEntry(uid) {
    //console.log("edit entry " + uid);
    if(!uid) return;
    var entry = document.getElementById("gh-weblog-"+uid),
        content = entry.querySelector(".content"),
        ocontent = entry.querySelector(".original.content");
    // switcharoo
    if(!document.body.classList.contains("default")) {
      hide(content);
      show(ocontent);
      // Set up file drag/drop behaviour
      ocontent.addEventListener('dragover', cancel);
      ocontent.addEventListener('dragenter', cancel);
      ocontent.addEventListener('drop', dropHandler);
      ocontent.focus();
    }
  };

  /**
   *
   */
  context.updateEntry = function updateEntry(uid, ocontent) {
    //console.log("update entry " + uid);
    if(!uid) return;
    var entryObject = context.entries[""+uid];
    var entry = document.getElementById("gh-weblog-"+uid);
    // content change?
    if (ocontent) {
      var content = entry.querySelector(".content");
      var newContent = ocontent.value;
      // record the change to the entry
      var updated = false;
      if (entryObject.content.trim() != newContent.trim()) {
        entryObject.content = newContent;
        entryObject.updated = Date.now();
        updated = true;
      }
      // reswitcharoo
      hide(ocontent);
      content.innerHTML = marked(newContent);
      context.processors.forEach(function(fn) { fn(content); });
      show(content);
      if(!updated) return;
    }
    // send a github "create" commit to github for this entry's file
    if (entry.classList.contains("pending")) {
      context.saveEntry(uid, function afterSaving(err) {
        entry.classList.remove("pending");
      });
    }
    // send a github "update" commit to github for this entry's file
    else {
      var entryString = JSON.stringify(entryObject);
      var filename = cfnGenerator(uid);
      var path = context.path + 'content/' + filename;
      branch.write(path, entryString, 'update for entry '+filename);
    }
  };

  /**
   *
   */
  context.saveEntry = function saveEntry(uid, afterSaving) {
    //console.log("save entry " + uid);
    if(!uid) return;
    var entryObject = context.entries[""+uid];
    delete entryObject.pending;
    var entryString = JSON.stringify(entryObject);
    var errors = false;

    // send a github "addition" commit up to github with the new file and an addition to content.js
    var filename = cfnGenerator(uid);
    var path = context.path + 'content/' + filename;
    //console.log("saveEntry", path);
    branch.write(path, entryString + '\n', 'weblog entry '+filename)
          .then(function() {
            //console.log("post save hook");
            setTimeout(function(){
              context.saveContentJS(filename);
              cue(afterSaving);
            }, cacheDelay);
          });
  };

  function formRSS(entries) {
    var head = [
        '<?xml version="1.0" encoding="UTF-8" ?>'
      , '<rss version="2.0">'
      , '<channel>'
      , '<title>jdotpz.github.io</title>'
      , '<description>' + document.querySelector("title").innerHTML + '</description>'
      , '<link>' +  window.location.toString() + '</link>'
      , '<lastBuildDate>' + (new Date()).toString() + '</lastBuildDate>'
      , '<pubDate>' + (new Date()).toString() + '</pubDate>'
      , '<ttl>1440</ttl>'
    ].join("\n") + "\n";

    var content = '';
//    Object.keys(entries).reverse().slice(0,20).forEach(function(key) {
    Object.keys(entries).slice(0,20).forEach(function(key) {
      var e = entries[key];
      if (!e) return;
      var entryString = [
          '<item>'
        , '<title>' + (function() {
             return e.content.split("\n")[0].replace(/#/g,'');
          }())+ '</title>'
        , (function(tags) {
          var s = [];
          tags.forEach(function(tag) {
            s.push('<category>' + tag + '</category>');
          });
          return s.join("\n");
        }(e.tags))
        , '<link>' + window.location.toString() + '#gh-weblog-' + e.published + '</link>'
        , '<guid>' + e.published + '</guid>'
        , '<pubDate>' + (new Date(e.published)).toString() + '</pubDate>'
        , '</item>'
      ];
      content += entryString.join("\n");
    });
    content += "\n";

    var tail = [
        '</channel>'
      , '</rss>'
    ].join("\n") + "\n";

    return head + content + tail;
  }

  /**
   * Save the update to the content.js file, and regenerate the RSS
   */
  context.saveContentJS = function saveContentJS(filename, removeFile, uid) {
    var shortString = filename.replace(".json",'');
    if(removeFile) {
      var pos = context.content.indexOf(shortString);
      if (pos > -1) { context.content.splice(pos, 1); }
    }
    else { context.content.push(shortString); }

    var path = context.path + 'js/content.js';
    var contentString = 'window["gh-weblog"].content = [\n  "' + context.content.join('",\n  "') + '"\n];\n';

    branch.write(path, contentString, 'content entry update (' + (removeFile ? 'entry deleted' : 'new entry') + ') for ' + filename)
          .then(function() {
            setTimeout(function() {
              if(removeFile) {
                context.entries[""+uid] = false;
              }
              var rssPath = context.path + 'rss.xml';
              var rssContentString = formRSS(context.entries);
              branch.write(rssPath, rssContentString, 'content entry RSS update (' + (removeFile ? 'entry deleted' : 'new entry') + ') for ' + filename);
            }, 2000);
          });
  };

  /**
   *
   */
  context.removeEntry = function removeEntry(uid) {
    //console.log("remove entry " + uid);
    if(!uid) return;
    var entry = document.getElementById("gh-weblog-"+uid);
    var confirmation = confirm("Are you sure you want to remove this entry?");
    if(confirmation) remove(entry);

    // send a github "removal" commit up to github for the old file and removal from content.js
    var filename = cfnGenerator(uid);
    var path = context.path + 'content/' + filename;
    //console.log("removeEntry", path);
    branch.remove(path, "removing entry " + filename)
          .then(function() {
            //console.log("post remove hook");
            setTimeout(function() {
              var removeFile = true;
              context.saveContentJS(filename, removeFile, uid);
            }, 2000);
          });
  };

  /**
   *
   */
  context.setCredentials = function setCredentials(silent) {
    var creds = localStorage["gh-weblog-token"];
    var newcreds = (silent ? creds || "undefined": prompt("Please specify your github token" + (creds ? ". Current token: "+creds : '')));
    if(newcreds.trim()=="") { newcreds = "undefined"; }
    localStorage["gh-weblog-token"] = newcreds;
    if(newcreds == "undefined") { document.body.classList.add("default"); }
    else {
      document.body.classList.remove("default");
      github = new Octokit({ token: newcreds });
      window.repo = repo = github.getRepo(context.username, context.repo);
      window.branch = branch = repo.getBranch(context.branch);
    }
  };
}
