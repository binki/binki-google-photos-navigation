// ==UserScript==
// @name binki-google-photos-navigation
// @version 1.3
// @grant none
// @author Nathan Phillip Brink (binki) (@ohnobinki)
// @homepageURL https://github.com/binki/binki-google-photos-navigation
// @include https://photos.google.com/*
// @require https://github.com/binki/binki-userscript-delay-async/raw/252c301cdbd21eb41fa0227c49cd53dc5a6d1e58/binki-userscript-delay-async.js
// @require https://github.com/binki/binki-userscript-when-element-changed-async/raw/88cf57674ab8fcaa0e86bdf5209342ec7780739a/binki-userscript-when-element-changed-async.js
// ==/UserScript==

(() => {
  const isTesting = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
  const maybeUseAssert = action => {
    if (isTesting) {
      action(require('assert').strict);
    }
  };

  let lastNavigationPromise = Promise.resolve();
  
  function findCWizParent (node) {
    if (!node) return;
    if (node.localName === 'c-wiz') {
      return node.parentNode;
    }
    return findCWizParent(node.parentNode);
  }
  
  function findTextarea(cWizParent) {
    return [...cWizParent.querySelectorAll('input, textarea')].find(textarea => {
      return textarea.offsetParent;
    });
  }

  function navigate(keyCode, key, right) {
    // Wait until the prior navigation has completed prior to acting
    // since we need to see the page post-navigation to be able to
    // make decisions.
    lastNavigationPromise = lastNavigationPromise.then(async () => {
      const originalTextarea = document.querySelector('input:focus, textarea:focus');
      if (!originalTextarea) return;

      // The textarea has a c-wiz ancestor. The Photos stuff seems to
      // recycle/cache c-wiz but create a new one upon navigation. So to see the new one be selected/displayed, have to find the parent of our c-wiz and watch for changes.
      const cWizParent = findCWizParent(originalTextarea);
      if (!cWizParent) return;
      

      // One way to do navigation is to fire the key (keyCode required even though
      // it???s deprecated) at the document. However, because of how Google???s stuff
      // works, switching photos often also switches out the input field. So we
      // need to be able to refocus the input field. Now, we want to do that after
      // requesting a navigation, but we don???t want to do it when trying to go beyond the first photo????
      // So, determine if we even can navigate forward or back.
      //
      // Find all of the navigation buttons and classify them:
      const arrowButtons = [...document.querySelectorAll('svg')].filter(svg => {
        // If is a child of a display:none, will not have an offsetParent.
        if (!svg.parentNode.offsetParent) return false;

        // Check things based on the parent node which is an HTML
        // element and will thus have normal properties generally.
        svg = svg.parentNode;
        // Ignore things like Document (not Element).
        if (!svg.attributes) return false;
        // The parent will have role=button.
        if (!svg.getAttribute('role') === 'button') return false;
        // The parent will have jsaction with a ???click:??? somewhere.
        if (!/click:/.test(svg.getAttribute('jsaction') || '')) return false;
        // The svg will be the parent???s only child (unlike some things which fulfil the above conditions but are not navigation buttons and are not only children).
        if (svg.children.length !== 1) return false;
        // The svg will not be contained by something that has role=menubar.
        while (svg && svg.attributes) {
          if (svg.getAttribute('role') === 'menubar') return false;
          svg = svg.parentNode;
        }
        // Hopefully we are only left with arrow buttons at this point.
        return true;
      }).map(svg => {
        const path = [...svg.children].filter(child => {
          return child.localName === 'path';
        })[0];
        if (!path) return;
        const d = path.getAttribute('d');
        if (!d) return;
        const direction = getPathArrowDirection(d);
        if (!direction) return;
        return {
          svg,
          direction,
        };
      }).filter(x => x);
      const arrowButton = arrowButtons.filter(x => {
        return x.direction === (right ? 1 : -1);
      })[0];
      if (!arrowButton) {
        console.log(`Unable to find ${right ? 'right' : 'left'} arrow button.`);
        return;
      }
      arrowButton.svg.parentNode.click();

      while (true) {
        await whenElementChangedAsync(cWizParent);
        const foundTextarea = findTextarea(cWizParent);
        if (!foundTextarea || foundTextarea === originalTextarea) continue;
        foundTextarea.focus();
        break;
      }
    }).catch(ex => {
      // Log any exception and then proceed.
      console.error(ex);
    });
  }

  function getPathCommands(d) {
    let currentCommand = '';
    const commands = [];
    while (true) {
      // Eat any whitespace.
      d = d.replace(/^\s+/, '');
      if (!d) break;
      const maybeNewCommand = /^[a-zA-Z]?/.exec(d)[0];
      d = d.substring(maybeNewCommand.length);
      currentCommand = maybeNewCommand || currentCommand;
      if (!currentCommand) throw new Error(`Expected command`);
      const argumentCount = 'LlMmTt'.indexOf(currentCommand) !== -1 ? 2
        : 'HhVv'.indexOf(currentCommand) !== -1 ? 1
        : 'Cc'.indexOf(currentCommand) !== -1 ? 6
        : 'QqSs'.indexOf(currentCommand) !== -1 ? 4
        : 'Aa'.indexOf(currentCommand) !== -1 ? 7
        : 'Zz'.indexOf(currentCommand) !== -1 ? 0
        : (() => {
          throw new Error(`Unsupported SVG path data command: ${currentCommand}`);
        })();
      const args = [];
      while (args.length < argumentCount) {
        // Eat up any space.
        d = d.replace(/^\s+/, '');
        if (!d) throw new Error(`Expected additional arguments for command ${currentCommand}`);
        const maybeArgumentString = /^-?([0-9]*\.)?[0-9]+/.exec(d)[0];
        if (!maybeArgumentString) throw new Error(`Expecting argument for ${currentCommand} near ???${d.substring(0, 32)}???`);
        args.push(maybeArgumentString);
        d = d.substring(maybeArgumentString.length);
      }
      commands.push({
        command: currentCommand,
        args: args,
      });
    }
    return commands;
  }

  function getPathAbsoluteCoordinates(d) {
    const commands = getPathCommands(d);
    // Build a stream of all the absolute coordinates.
    const coordinates = [];
    {
      let initialX = 0;
      let initialY = 0;
      let x = 0;
      let y = 0;
      function f(s) {
        const value = parseFloat(s);
        if (isNaN(value)) throw new Error(`Not parsable as a float: ${s}`);
        return value;
      }
      for (const {
        command,
        args,
      } of commands) {
        switch (command) {
        case 'h':
          x += f(args[0]);
          break;
        case 'H':
          x = f(args[0]);
          break;
        case 'l':
          x += f(args[0]);
          y += f(args[1]);
          break;
        case 'L':
          x = f(args[0]);
          y = f(args[1]);
          break;
        case 'm':
          initialX = x += f(args[0]);
          initialY = y += f(args[1]);
          break;
        case 'M':
          initialX = x = f(args[0]);
          initialY = y = f(args[1]);
          break;
        case 'z':
        case 'Z':
          x = initialX;
          y = initialY;
          break;
        default: throw new Error(`Unhandled command: ${command}`);
        }
        coordinates.push([x, y]);
      }
    }
    return coordinates;
  }

  // Since the tree isn???t semantic, need to try to identify the buttons by their
  // SVG paths. A right caret (e.g., ???>???) will start at a point, move
  // vertically and to the right, and then move vertically again and to the
  // left. A left caret (e.g., ???<???) will start at a point, move vertically and
  // to the left, and then move vertically again and to the right. To try to
  // support the graphics changing slightly without the major form changing, we
  // parse out the SVG path a little???
  function getPathArrowDirection(d) {
    const coordinates = getPathAbsoluteCoordinates(d);
    const yValues = coordinates.map(p => p[1]).sort((a, b) => a - b);
    const yMin = yValues[0];
    const yMax = yValues[yValues.length - 1];
    const height = yMax - yMin;
    const yMidLow = yMin + 0.25*height;
    const yMidHigh = yMin + 0.75*height;
    // Divide points into mid and extreme
    const midXValues = [];
    const extremeXValues = [];
    for (const p of coordinates) {
      if (p[1] < yMidLow || p[1] > yMidHigh) {
        extremeXValues.push(p[0]);
      } else {
        midXValues.push(p[0]);
      }
    }
    if (!midXValues.length || !extremeXValues.length) {
      return 0;
    }
    const [meanMidXValue, meanExtremeXValue] = [midXValues, extremeXValues].map(xValues => xValues.reduce((acc, value) => acc + value, 0)/xValues.length);
    return meanMidXValue < meanExtremeXValue ? -1 : meanMidXValue > meanExtremeXValue ? 1 : 0;
  }

  maybeUseAssert(assert => {
    assert.deepEqual(getPathCommands('M15.41 16.09l-4.58-4.59 4.58-4.59L14 5.5l-6 6 6 6z'), [
      {
        args: [
          '15.41',
          '16.09',
        ],
        command: 'M',
      },
      {
        args: [
          '-4.58',
          '-4.59',
        ],
        command: 'l',
      },
      {
        args: [
          '4.58',
          '-4.59',
        ],
        command: 'l',
      },
      {
        args: [
          '14',
          '5.5',
        ],
        command: 'L',
      },
      {
        args: [
          '-6',
          '6',
        ],
        command: 'l',
      },
      {
        args: [
          '6',
          '6',
        ],
        command: 'l',
      },
      {
        args: [],
        command: 'z',
      },
    ]);
    assert.deepEqual(getPathAbsoluteCoordinates('M15.41 16.09l-4.58-4.59 4.58-4.59L14 5.5l-6 6 6 6z'), [
      [15.41, 16.09],
      [10.83, 11.5],
      [15.41, 6.91],
      [14, 5.5],
      [8, 11.5],
      [14, 17.5],
      [15.41, 16.09],
    ]);
    assert.deepEqual(getPathArrowDirection('M15.41 16.09l-4.58-4.59 4.58-4.59L14 5.5l-6 6 6 6z'), -1);
    assert.deepEqual(getPathArrowDirection('M8.59 16.34l4.58-4.59-4.58-4.59L10 5.75l6 6-6 6z'), 1);
  });
  
  async function addAlbum(textElement) {
    const cWizParent = findCWizParent(textElement);
    // Open the dropdown menu.
    [...document.querySelectorAll('[role=menubar] > span > div > div + div + div:last-child')].find(dotsMenuElement => {
      // In album view mode (URI starts with /album), the dots menu of the album itself is
      // still in the DOM and clickable. It is earlier in the DOM than the onscreen, per-photo
      // one. So make sure to ignore invisible when searching for this menu.
    	return dotsMenuElement.offsetParent;
    }).firstChild.click();
    while (true) {
      // Some menus exist which remain active which have multiple options. However, our menu has at least 4
      // options. Which specific option we choose is itself complicated and cannot be expressed with a selector.
      // But this selector can be used to tell whether the menu is present.
      const arbitraryMenuButtonSelector = 'div[role=menu][data-back-to-cancel=false] > div > div > span + span + span + span';
      const arbitraryMenuButton = document.querySelector(arbitraryMenuButtonSelector);
      if (!arbitraryMenuButton) {
        await whenElementChangedAsync(document.body);
        continue;
      }
      // Different screens capable of adding an image to an album have different per-photo menus. Also, the menu
      // varies depending on whether or not the photo has motion or is a video. So one way of selecting the correct
      // menu button will not work universally. Here are two examples of link lists:
      //
      // * /photo for picture without motion ?????????????????????, ???????????????Shift+D???, ??????????????? ??????Shift+R???, ???????????? ?????????, ????????? ????????? ?????????, ???????????? ?????? ?????????, ????????? ?????? ?????????, ?????????Shift+A???
      // * /photo for picture with motion ???????????????????????????, ?????????????????????Shift+D???, ?????????????????????????????????, ???????????????Shift+R???, ???????????????????????????, ????????????????????????????????????, ?????????????????? ????????????????????????, ????????????????????????????????????, ??????????????????Shift+A???
      // * /share for (same) picture with motion: ???????????????????????????, ???????????????Shift+R???, ?????????????????????Shift+D???, ?????????????????????????????????, ???????????????????????????, ????????????????????????????????????, ?????????????????? ????????????????????????, ????????????????????????????????????, ????????????????????????????????????, ???????????????????????????#???, ????????????????????????
      // * /photo for video ???????????????????????????, ????????????????????????, ?????????????????????Shift+D???, ???????????????????????????, ????????????????????????????????????, ??????????????????Shift+A???
      //
      // So, it looks like our ??????????????????????????? link is:
      //
      // * after Shift+D (seems to be locale-independent!) if it exists
      // * after Shift+R (seems to be locale-independent!) if it exists
      // * after all items containing ????????????????????????/??????????????????/???Download??? (locale-specific string which can be extracted from the entry with ???Shift+D???)
      //
      // If an entry has a shortcut specified, it is in a separate div. So there is no need to manually separate
      // it out. Start by scanning for everything.
      const menu = [...arbitraryMenuButton.parentElement.querySelectorAll('span > div[jsaction]')].map(itemElement => {
        return {
          itemElement,
          lowerText: itemElement.firstChild.textContent.toLowerCase(),
          lowerShortcut: itemElement.children.length > 1 ? itemElement.children.item(1).textContent.toLowerCase() : null,
        };
      });
      const downloadMenuItemIndex = menu.findIndex(item => item.lowerShortcut === 'shift+d');
      const downloadVideoMenuItemIndex = downloadMenuItemIndex === -1 ? -1 : menu.findIndex((item, index) => index > downloadMenuItemIndex && item.lowerText.indexOf(downloadMenuItemIndex.lowerText) !== -1);
      const rotateMenuItemIndex = menu.findIndex(item => item.lowerShortcut === 'shift+r');
      // The add to album menu item is the first menu item with an index greater than all of the above.
      // If we didn???t find any of the above options, then, well, we???ll probably launch the slideshow???that???s not
      // *that* bad, right?
      const addToAlbumMenuItemIndex = [downloadMenuItemIndex, downloadVideoMenuItemIndex, rotateMenuItemIndex].reduce((a, b) => Math.max(a, b)) + 1;
      const addToAlbumButton = menu[addToAlbumMenuItemIndex].itemElement;
      // It takes time to load and I do not think it shows progress, so just keep clicking until it works x.x.
      while (true) {
        addToAlbumButton.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        addToAlbumButton.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        await delayAsync(20);
        if (!document.querySelector(arbitraryMenuButtonSelector)) {
          // Wait for the dialog to appear.
          while (true) {
            const dialogSelector = '[role=dialog]';
            if (!document.querySelector(dialogSelector)) {
              await whenElementChangedAsync(document.body);
              continue;
            }
            console.log('found dialog. Waiting for it to close');
            while (true) {
              if (document.querySelector(dialogSelector)) {
                await whenElementChangedAsync(document.body);
                continue;
              }
              // If the dialog is closed by cancelling, we will end up incorrectly attempting to refocus the
              // textarea later. For now, am going to accept that as a limitation.
              while (true) {
                const newTextElement = findTextarea(cWizParent);
                if (!newTextElement || newTextElement === textElement) {
                	await whenElementChangedAsync(cWizParent);
                  continue;
                }
                newTextElement.focus();
	              return;
              }
            }
          }
        }
      }
    }
  }

  if (!isTesting) {
    document.body.addEventListener('keydown', e => {
      if (e.keyCode === 229 || e.isComposing) {
        return;
      }
      // Only do this if the input target is an input/textarea element which will trap the arrow.
      if (e.target.localName !== 'textarea' && e.target.localName !== 'input') {
        return;
      }
      if (!e.altKey && e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === '[') {
          navigate(219, e.key, false);
          e.preventDefault();
        } else if (e.key === ']') {
          navigate(221, e.key, true);
          e.preventDefault();
        } else if (e.key === '\'') {
          // Launch the ???Add to album??? workflow.
          addAlbum(e.target);
        }
      }
    });
  }
})();
