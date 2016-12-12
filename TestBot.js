
const prompt = require('souffleur');

const testPrompt = () =>{
    return Promise.resolve().then(() => {
	    return prompt(["hi?"]);
	})
    .then(results => {
      let parsed = JSON.parse(results["hi?"])
	    parsed.forEach(p => console.log(p))

	})
}

testPrompt();
