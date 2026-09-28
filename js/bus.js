'use strict';

const VTTBus = (() => {
  const NAME = 'dnd-virtual-table-v1';
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(NAME) : null;

  function emit(data) {
    if (!data || typeof data !== 'object') return;
    listeners.forEach((fn) => {
      try {
        fn(data);
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (channel) {
    channel.onmessage = (event) => emit(event.data);
  } else {
    window.addEventListener('storage', (event) => {
      if (event.key !== NAME || !event.newValue) return;
      try {
        emit(JSON.parse(event.newValue));
      } catch (error) {
        console.error(error);
      }
    });
  }

  return {
    send(data) {
      if (channel) {
        channel.postMessage(data);
        return;
      }
      try {
        localStorage.setItem(NAME, JSON.stringify(Object.assign({ _n: Math.random() }, data)));
      } catch (error) {
        console.error(error);
      }
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
