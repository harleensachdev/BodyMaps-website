import React, { useEffect, useState } from "react";
import './OpacitySlider.css';


type Props = {
  opacityValue: number;
  handleOpacityOnSliderChange: (value: React.ChangeEvent<HTMLInputElement>) => void;
  handleOpacityOnFormSubmit: (value: number) => void;
}
export default function OpacitySlider({
  opacityValue,
  handleOpacityOnSliderChange,
  handleOpacityOnFormSubmit
}: Props) {
  const [textValue, setTextValue] = useState(opacityValue);

  // Sync input field when external opacityValue changes
  useEffect(() => {
    setTextValue(opacityValue);
  }, [opacityValue]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTextValue(Number(e.target.value));
  };

  const handleOpacitySubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = Number(textValue);
    if (isNaN(v)) return;

    // Clamp value between 0 and 100
    v = Math.max(0, Math.min(100, v));
    setTextValue(v);
    handleOpacityOnFormSubmit(v);
  };



  return (
    <div className="windowing-slider">
      <div className="flex gap-1 flex-col justify-center items-center border">
        <div className="flex justify-between w-full items-center">
          
        <div style={{ color: 'white' }}>Label Opacity</div>
        <form onSubmit={handleOpacitySubmit} className="w-1/3">
          <input
            type="text"
            value={textValue}
            onChange={handleTextChange}
            className="text-white rounded-md border p-1 w-full"
            />
        </form>
          </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          className="w-full"
          value={opacityValue}
          onChange={handleOpacityOnSliderChange}
        />
      </div>
    </div>
  );
}
